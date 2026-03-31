import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from app.schemas import PracticeLogCreate, PracticeLogResponse, ScoreUploadAnalysisResponse
from app.services.score_analysis import analyze_score_file

router = APIRouter(prefix="/scores", tags=["scores"])

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "storage" / "scores"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
SCORE_INDEX_FILE = UPLOAD_ROOT / "index.json"


def _load_scores() -> list[ScoreUploadAnalysisResponse]:
    if not SCORE_INDEX_FILE.exists():
        return []

    try:
        payload = json.loads(SCORE_INDEX_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []

    loaded_scores: list[ScoreUploadAnalysisResponse] = []
    for item in payload:
        try:
            loaded_scores.append(ScoreUploadAnalysisResponse.model_validate(item))
        except Exception:  # noqa: BLE001
            continue

    return loaded_scores


def _save_scores() -> None:
    serialized = [score.model_dump(mode="json") for score in mock_scores]
    SCORE_INDEX_FILE.write_text(
        json.dumps(serialized, indent=2),
        encoding="utf-8",
    )


mock_scores: list[ScoreUploadAnalysisResponse] = _load_scores()
mock_logs: list[PracticeLogResponse] = []


def _find_score(score_id: str) -> ScoreUploadAnalysisResponse:
    for score in mock_scores:
        if score.id == score_id:
            return score

    raise HTTPException(status_code=404, detail="Score not found.")


async def _run_score_parsing(score_id: str) -> None:
    score = _find_score(score_id)
    if not score.stored_path:
        score.processing_status = "failed"
        score.processing_progress = 100
        _save_scores()
        return

    score.processing_status = "parsing"
    score.processing_progress = 35
    _save_scores()

    try:
        analysis = await asyncio.to_thread(analyze_score_file, Path(score.stored_path), score.format)
        score.analysis = analysis
        score.extraction_accuracy = max(
            (voice.confidence for voice in analysis.voices),
            default=0,
        )
        if analysis.conversion_required:
            score.processing_status = "needs_conversion"
            score.processing_progress = 100
        else:
            score.processing_status = "parsed"
            score.processing_progress = 100
    except Exception as exc:  # noqa: BLE001
        score.processing_status = "failed"
        score.processing_progress = 100
        score.analysis = None
        _save_scores()
        return

    _save_scores()


@router.get("", response_model=list[ScoreUploadAnalysisResponse])
async def list_scores() -> list[ScoreUploadAnalysisResponse]:
    return mock_scores


@router.post("", response_model=ScoreUploadAnalysisResponse)
async def upload_score(
    file: UploadFile = File(...),
    title: str = Form(""),
    composer: str = Form("Uploaded from mobile"),
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
        analysis=None,
    )
    mock_scores.insert(0, score)
    _save_scores()
    return score


@router.post("/{score_id}/parse", response_model=ScoreUploadAnalysisResponse)
async def parse_score(score_id: str, background_tasks: BackgroundTasks) -> ScoreUploadAnalysisResponse:
    score = _find_score(score_id)

    if score.processing_status == "parsing":
        return score

    score.processing_status = "queued"
    score.processing_progress = 25
    _save_scores()
    background_tasks.add_task(_run_score_parsing, score_id)
    return score


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
async def get_score(score_id: str) -> ScoreUploadAnalysisResponse:
    return _find_score(score_id)
