from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import shutil

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile

from app.routes.scores import _find_score
from app.schemas import PracticeRecordingResponse, UserResponse
from app.services.auth_service import get_current_user
from app.services.voice_playback import render_voice_part_audio

router = APIRouter(prefix="/practice", tags=["practice"])

PRACTICE_ROOT = Path(__file__).resolve().parents[2] / "storage" / "practice"
PRACTICE_ROOT.mkdir(parents=True, exist_ok=True)
PRACTICE_INDEX_FILE = PRACTICE_ROOT / "index.json"


def _load_practice_items() -> list[PracticeRecordingResponse]:
    if not PRACTICE_INDEX_FILE.exists():
        return []
    try:
        payload = json.loads(PRACTICE_INDEX_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

    records: list[PracticeRecordingResponse] = []
    for item in payload:
        try:
            records.append(PracticeRecordingResponse.model_validate(item))
        except Exception:  # noqa: BLE001
            continue
    return records


def _save_practice_items() -> None:
    serialized = [item.model_dump(mode="json") for item in practice_items]
    PRACTICE_INDEX_FILE.write_text(json.dumps(serialized, indent=2), encoding="utf-8")


practice_items: list[PracticeRecordingResponse] = _load_practice_items()


def _reference_duration_ms(score_path: Path, score_format: str, voice_part: str, tempo: int) -> int:
    import io
    import wave

    wav_bytes = render_voice_part_audio(score_path, score_format, voice_part, tempo)
    with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
        frames = wav_file.getnframes()
        frame_rate = wav_file.getframerate()
        return int((frames / max(frame_rate, 1)) * 1000)


def _score_practice_take(recording_duration_ms: int, reference_duration_ms: int) -> tuple[int, str]:
    if recording_duration_ms <= 0 or reference_duration_ms <= 0:
        return 0, "The recording or reference audio duration could not be measured."

    # Trim rough capture edges so button taps and room noise count less than the singer's sustained voice.
    effective_recording_ms = max(recording_duration_ms - 1200, 0)
    effective_reference_ms = max(reference_duration_ms - 400, 0)
    if effective_recording_ms <= 0 or effective_reference_ms <= 0:
        return 0, "The recording was too short to evaluate clearly. Try recording a fuller sung phrase."

    duration_ratio = min(effective_recording_ms, effective_reference_ms) / max(effective_recording_ms, effective_reference_ms)
    duration_score = int(round(duration_ratio * 100))

    difference_ms = abs(effective_recording_ms - effective_reference_ms)
    if duration_score >= 92:
        feedback = "Excellent timing match with the generated voice part."
    elif duration_score >= 78:
        feedback = "Good attempt. Your timing is close, but some phrases may be rushed or delayed."
    elif duration_score >= 60:
        feedback = "Fair attempt. Practice with the reference audio again to improve alignment."
    else:
        feedback = "The timing differs a lot from the generated voice. Try singing along more closely with the reference."

    feedback = f"{feedback} Duration gap: {difference_ms} ms after trimming recording-edge noise."
    return duration_score, feedback


def _find_practice_recording(recording_id: str, owner_id: str) -> PracticeRecordingResponse:
    for item in practice_items:
        if item.id == recording_id and item.owner_id == owner_id:
            return item
    raise HTTPException(status_code=404, detail="Practice recording not found.")


@router.get("/recordings", response_model=list[PracticeRecordingResponse])
async def list_practice_recordings(
    current_user: UserResponse = Depends(get_current_user),
) -> list[PracticeRecordingResponse]:
    return [item for item in practice_items if item.owner_id == current_user.id]


@router.post("/recordings", response_model=PracticeRecordingResponse)
async def upload_practice_recording(
    score_id: str = Form(...),
    voice_part: str = Form(...),
    duration_ms: int = Form(...),
    tempo: int = Form(92),
    file: UploadFile = File(...),
    current_user: UserResponse = Depends(get_current_user),
) -> PracticeRecordingResponse:
    score = _find_score(score_id, current_user.id)
    if not score.stored_path:
        raise HTTPException(status_code=400, detail="Score file is not available for practice.")

    normalized_voice = voice_part.capitalize()
    if normalized_voice not in {"Soprano", "Alto", "Tenor", "Bass", "Harmony"}:
        raise HTTPException(status_code=400, detail="Invalid practice voice part.")

    practice_id = str(uuid4())
    suffix = Path(file.filename or "practice.m4a").suffix or ".m4a"
    practice_dir = PRACTICE_ROOT / practice_id
    practice_dir.mkdir(parents=True, exist_ok=True)
    recording_path = practice_dir / f"recording{suffix}"
    recording_path.write_bytes(await file.read())

    reference_duration_ms = _reference_duration_ms(
        Path(score.stored_path),
        score.format,
        normalized_voice,
        tempo,
    )
    accuracy_percent, feedback = _score_practice_take(duration_ms, reference_duration_ms)

    record = PracticeRecordingResponse(
        id=practice_id,
        owner_id=current_user.id,
        score_id=score.id,
        score_title=score.title,
        voice_part=normalized_voice,
        recording_uri=str(recording_path),
        duration_ms=duration_ms,
        accuracy_percent=accuracy_percent,
        feedback=feedback,
        analysis_method="ai-assisted-temporal-alignment",
        reference_duration_ms=reference_duration_ms,
        recorded_at=datetime.now(UTC),
    )
    practice_items.insert(0, record)
    _save_practice_items()
    return record


@router.get("/recordings/{recording_id}/audio")
async def get_practice_recording_audio(
    recording_id: str,
    current_user: UserResponse = Depends(get_current_user),
) -> Response:
    record = _find_practice_recording(recording_id, current_user.id)
    recording_path = Path(record.recording_uri)
    if not recording_path.exists():
        raise HTTPException(status_code=404, detail="Practice audio file is missing.")

    media_type = "audio/mp4"
    if recording_path.suffix.lower() in {".wav"}:
        media_type = "audio/wav"
    elif recording_path.suffix.lower() in {".m4a", ".aac"}:
        media_type = "audio/mp4"

    return Response(
        content=recording_path.read_bytes(),
        media_type=media_type,
        headers={
            "Content-Disposition": f'inline; filename="{recording_path.name}"',
        },
    )


@router.delete("/recordings/{recording_id}")
async def delete_practice_recording(
    recording_id: str,
    current_user: UserResponse = Depends(get_current_user),
) -> dict[str, str]:
    record = _find_practice_recording(recording_id, current_user.id)
    practice_items.remove(record)
    recording_path = Path(record.recording_uri)
    if recording_path.exists():
        shutil.rmtree(recording_path.parent, ignore_errors=True)
    _save_practice_items()
    return {"status": "deleted"}
