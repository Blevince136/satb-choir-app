from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter

from app.schemas import PracticeLogCreate, PracticeLogResponse, ScoreUploadAnalysisResponse

router = APIRouter(prefix="/demo", tags=["demo"])

demo_scores: list[ScoreUploadAnalysisResponse] = [
    ScoreUploadAnalysisResponse(
        id=str(uuid4()),
        title="Mwangaza wa Asubuhi",
        composer="ChoirLift Demo Library",
        format="MUSICXML",
        file_name="mwangaza-wa-asubuhi.musicxml",
        file_size=184_320,
        uploaded_at=datetime.now(UTC),
        processing_status="parsed",
        processing_progress=100,
        extraction_accuracy=94,
        stored_path=None,
        audio_cache_ready=True,
        audio_cache_tempo=92,
        analysis=None,
    )
]

demo_logs: list[PracticeLogResponse] = [
    PracticeLogResponse(
        id=str(uuid4()),
        singer_name="Jane Doe",
        voice_part="Alto",
        completion=81,
        feedback="Stable breath support and cleaner entrances in the middle section.",
        score_title="Mwangaza wa Asubuhi",
        recorded_at=datetime.now(UTC),
    )
]


@router.get("/scores", response_model=list[ScoreUploadAnalysisResponse])
async def list_demo_scores() -> list[ScoreUploadAnalysisResponse]:
    return demo_scores


@router.post("/mock-upload", response_model=ScoreUploadAnalysisResponse)
async def mock_upload_score(
    title: str = "",
    composer: str = "ChoirLift Demo Library",
    format: str = "MUSICXML",
) -> ScoreUploadAnalysisResponse:
    score = ScoreUploadAnalysisResponse(
        id=str(uuid4()),
        title=title.strip() or "Untitled score",
        composer=composer.strip() or "ChoirLift Demo Library",
        format=format.strip().upper() or "MUSICXML",
        file_name=f"{uuid4().hex}.xml",
        file_size=192_000,
        uploaded_at=datetime.now(UTC),
        processing_status="parsed",
        processing_progress=100,
        extraction_accuracy=88 + (len(demo_scores) % 10),
        stored_path=None,
        audio_cache_ready=True,
        audio_cache_tempo=92,
        analysis=None,
    )
    demo_scores.insert(0, score)
    return score


@router.get("/practice-logs", response_model=list[PracticeLogResponse])
async def list_demo_practice_logs() -> list[PracticeLogResponse]:
    return demo_logs


@router.post("/practice-logs", response_model=PracticeLogResponse)
async def create_demo_practice_log(payload: PracticeLogCreate) -> PracticeLogResponse:
    if payload.voice_part not in {"Soprano", "Alto", "Tenor", "Bass"}:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Invalid voice part.")

    entry = PracticeLogResponse(
        id=str(uuid4()),
        recorded_at=datetime.now(UTC),
        **payload.model_dump(),
    )
    demo_logs.insert(0, entry)
    return entry
