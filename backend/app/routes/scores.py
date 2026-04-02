import asyncio
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import shutil

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pymongo import ReturnDocument

from app.database import get_scores_collection, mongo_to_dict
from app.schemas import (
    PracticeLogCreate,
    PracticeLogResponse,
    ScoreUpdateRequest,
    ScoreUploadAnalysisResponse,
    UserResponse,
)
from app.services.score_analysis import analyze_score_file
from app.services.auth_service import get_current_user
from app.services.voice_playback import export_voice_file, render_voice_part_audio

router = APIRouter(prefix="/scores", tags=["scores"])

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "storage" / "scores"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
mock_logs: list[PracticeLogResponse] = []


async def _find_score(score_id: str, owner_id: str | None = None) -> ScoreUploadAnalysisResponse:
    query: dict[str, str] = {"id": score_id}
    if owner_id is not None:
        query["owner_id"] = owner_id
    score = mongo_to_dict(await get_scores_collection().find_one(query))
    if score is not None:
        return ScoreUploadAnalysisResponse.model_validate(score)
    raise HTTPException(status_code=404, detail="Score not found.")


async def _run_score_parsing(score_id: str) -> None:
    score = await _find_score(score_id)
    if not score.stored_path:
        await get_scores_collection().update_one(
            {"id": score_id},
            {"$set": {"processing_status": "failed", "processing_progress": 100}},
        )
        return

    await get_scores_collection().update_one(
        {"id": score_id},
        {
            "$set": {
                "processing_status": "parsing",
                "processing_progress": 35,
                "audio_cache_ready": False,
                "audio_cache_tempo": None,
            }
        },
    )

    try:
        analysis = await asyncio.to_thread(analyze_score_file, Path(score.stored_path), score.format)
        extraction_accuracy = max(
            (voice.confidence for voice in analysis.voices),
            default=0,
        )
        if analysis.conversion_required:
            await get_scores_collection().update_one(
                {"id": score_id},
                {
                    "$set": {
                        "analysis": analysis.model_dump(mode="json"),
                        "extraction_accuracy": extraction_accuracy,
                        "processing_status": "needs_conversion",
                        "processing_progress": 100,
                    }
                },
            )
        else:
            await get_scores_collection().update_one(
                {"id": score_id},
                {
                    "$set": {
                        "analysis": analysis.model_dump(mode="json"),
                        "extraction_accuracy": extraction_accuracy,
                        "processing_status": "parsed",
                        "processing_progress": 90,
                    }
                },
            )
            await asyncio.to_thread(_prewarm_score_audio, score, 92)
            await get_scores_collection().update_one(
                {"id": score_id},
                {
                    "$set": {
                        "processing_progress": 100,
                        "audio_cache_ready": True,
                        "audio_cache_tempo": 92,
                    }
                },
            )
    except Exception:  # noqa: BLE001
        await get_scores_collection().update_one(
            {"id": score_id},
            {
                "$set": {
                    "processing_status": "failed",
                    "processing_progress": 100,
                    "analysis": None,
                    "audio_cache_ready": False,
                    "audio_cache_tempo": None,
                }
            },
        )
        return


def _resolve_score_source(score: ScoreUploadAnalysisResponse) -> tuple[Path, str]:
    if score.analysis and score.analysis.prepared_source_path:
        prepared_path = Path(score.analysis.prepared_source_path)
        if prepared_path.exists():
            prepared_suffix = prepared_path.suffix.lower()
            if prepared_suffix in {".musicxml", ".xml", ".mxl"}:
                return prepared_path, "MUSICXML"
            if prepared_suffix in {".mid", ".midi"}:
                return prepared_path, "MIDI"
            return prepared_path, score.format

    if not score.stored_path:
        raise HTTPException(status_code=400, detail="Score file is not available.")

    stored_path = Path(score.stored_path)
    if score.format.upper() == "PDF":
        for suffix in (".musicxml", ".xml", ".mxl"):
            sibling_export = stored_path.with_suffix(suffix)
            if sibling_export.exists():
                return sibling_export, "MUSICXML"

    return stored_path, score.format


def _prewarm_score_audio(score: ScoreUploadAnalysisResponse, tempo: int) -> None:
    source_path, source_format = _resolve_score_source(score)
    voices_to_render = ["Harmony", "Soprano", "Alto", "Tenor", "Bass"]
    for voice_name in voices_to_render:
        try:
            render_voice_part_audio(source_path, source_format, voice_name, tempo)
        except ValueError:
            continue


@router.get("", response_model=list[ScoreUploadAnalysisResponse])
async def list_scores(
    current_user: UserResponse = Depends(get_current_user),
) -> list[ScoreUploadAnalysisResponse]:
    cursor = get_scores_collection().find({"owner_id": current_user.id}).sort("uploaded_at", -1)
    documents = [mongo_to_dict(item) async for item in cursor]
    return [ScoreUploadAnalysisResponse.model_validate(item) for item in documents if item is not None]


@router.post("", response_model=ScoreUploadAnalysisResponse)
async def upload_score(
    file: UploadFile = File(...),
    title: str = Form(""),
    composer: str = Form("Uploaded from mobile"),
    current_user: UserResponse = Depends(get_current_user),
) -> ScoreUploadAnalysisResponse:
    suffix = Path(file.filename or "").suffix.lower()
    allowed_formats = {
        ".pdf": "PDF",
        ".mid": "MIDI",
        ".midi": "MIDI",
        ".xml": "MUSICXML",
        ".musicxml": "MUSICXML",
    }

    if suffix not in allowed_formats:
        raise HTTPException(status_code=400, detail="Unsupported score format.")

    content = await file.read()
    score_id = str(uuid4())
    derived_title = title.strip() or Path(file.filename or "Untitled").stem
    score_format = allowed_formats[suffix]
    target_dir = UPLOAD_ROOT / score_id
    target_dir.mkdir(parents=True, exist_ok=True)
    file_name = file.filename or f"{derived_title}{suffix}"
    stored_file_path = target_dir / file_name
    stored_file_path.write_bytes(content)

    score = ScoreUploadAnalysisResponse(
        id=score_id,
        title=derived_title,
        composer=composer.strip() or "Uploaded from mobile",
        format=score_format,
        file_name=file_name,
        file_size=len(content),
        uploaded_at=datetime.now(UTC),
        processing_status="uploaded",
        processing_progress=20,
        extraction_accuracy=0,
        stored_path=str(stored_file_path),
        audio_cache_ready=False,
        audio_cache_tempo=None,
        owner_id=current_user.id,
        analysis=None,
    )
    await get_scores_collection().insert_one(score.model_dump(mode="json"))
    return score


@router.post("/{score_id}/parse", response_model=ScoreUploadAnalysisResponse)
async def parse_score(
    score_id: str,
    background_tasks: BackgroundTasks,
    current_user: UserResponse = Depends(get_current_user),
) -> ScoreUploadAnalysisResponse:
    score = await _find_score(score_id, current_user.id)

    if score.processing_status == "parsing":
        return score

    await get_scores_collection().update_one(
        {"id": score_id, "owner_id": current_user.id},
        {"$set": {"processing_status": "queued", "processing_progress": 25}},
    )
    background_tasks.add_task(_run_score_parsing, score_id)
    return await _find_score(score_id, current_user.id)


@router.get("/{score_id}/playback")
async def get_voice_playback(
    score_id: str,
    voice_part: str = Query(...),
    tempo: int = Query(92, ge=30, le=200),
    current_user: UserResponse = Depends(get_current_user),
) -> Response:
    score = await _find_score(score_id, current_user.id)
    normalized_voice = voice_part.capitalize()
    if normalized_voice not in {"Harmony", "Soprano", "Alto", "Tenor", "Bass"}:
        raise HTTPException(status_code=400, detail="Invalid voice part.")
    try:
        source_path, source_format = _resolve_score_source(score)
        audio_bytes = render_voice_part_audio(
            source_path,
            source_format,
            normalized_voice,
            tempo,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return Response(
        content=audio_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": f'inline; filename="{score.id}-{normalized_voice.lower()}-{tempo}.wav"'
        },
    )


@router.get("/{score_id}/export")
async def export_voice(
    score_id: str,
    voice_part: str = Query(...),
    export_format: str = Query(..., alias="format"),
    tempo: int = Query(92, ge=30, le=200),
    current_user: UserResponse = Depends(get_current_user),
) -> Response:
    score = await _find_score(score_id, current_user.id)
    normalized_voice = voice_part.capitalize()
    if normalized_voice not in {"Harmony", "Soprano", "Alto", "Tenor", "Bass"}:
        raise HTTPException(status_code=400, detail="Invalid voice part.")
    try:
        source_path, source_format = _resolve_score_source(score)
        file_bytes, extension, media_type = export_voice_file(
            source_path,
            source_format,
            normalized_voice,
            tempo,
            export_format,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={
            "Content-Disposition": (
                f'attachment; filename="{score.title}-{normalized_voice.lower()}.{extension}"'
            )
        },
    )


@router.patch("/{score_id}", response_model=ScoreUploadAnalysisResponse)
async def update_score(
    score_id: str,
    payload: ScoreUpdateRequest,
    current_user: UserResponse = Depends(get_current_user),
) -> ScoreUploadAnalysisResponse:
    updated = await get_scores_collection().find_one_and_update(
        {"id": score_id, "owner_id": current_user.id},
        {"$set": {"title": payload.title.strip(), "composer": payload.composer.strip()}},
        return_document=ReturnDocument.AFTER,
    )
    updated_dict = mongo_to_dict(updated)
    if updated_dict is None:
        raise HTTPException(status_code=404, detail="Score not found.")
    return ScoreUploadAnalysisResponse.model_validate(updated_dict)


@router.delete("/{score_id}")
async def delete_score(
    score_id: str,
    current_user: UserResponse = Depends(get_current_user),
) -> dict[str, str]:
    score = await _find_score(score_id, current_user.id)
    if score.stored_path:
        score_dir = Path(score.stored_path).parent
        if score_dir.exists():
            shutil.rmtree(score_dir, ignore_errors=True)
    await get_scores_collection().delete_one({"id": score_id, "owner_id": current_user.id})
    return {"status": "deleted"}


@router.get("/practice-logs", response_model=list[PracticeLogResponse])
async def list_practice_logs() -> list[PracticeLogResponse]:
    return mock_logs


@router.post("/practice-logs", response_model=PracticeLogResponse)
async def create_practice_log(payload: PracticeLogCreate) -> PracticeLogResponse:
    if payload.voice_part not in {"Soprano", "Alto", "Tenor", "Bass"}:
        raise HTTPException(status_code=400, detail="Invalid voice part.")

    entry = PracticeLogResponse(
        id=str(uuid4()),
        recorded_at=datetime.now(UTC),
        **payload.model_dump(),
    )
    mock_logs.insert(0, entry)
    return entry


@router.get("/{score_id}", response_model=ScoreUploadAnalysisResponse)
async def get_score(
    score_id: str,
    current_user: UserResponse = Depends(get_current_user),
) -> ScoreUploadAnalysisResponse:
    return await _find_score(score_id, current_user.id)
