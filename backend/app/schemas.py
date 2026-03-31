from datetime import datetime

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "satb-choir-api"


class ScoreUploadResponse(BaseModel):
    id: str
    title: str
    composer: str
    format: str
    file_name: str
    file_size: int = Field(ge=0)
    uploaded_at: datetime
    processing_status: str = "uploaded"
    processing_progress: int = Field(default=0, ge=0, le=100)
    extraction_accuracy: int = Field(ge=0, le=100)
    stored_path: str | None = None


class VoicePartSummary(BaseModel):
    voice_part: str
    detected_notes: int = Field(ge=0)
    average_pitch_midi: float | None = None
    lowest_pitch: str | None = None
    highest_pitch: str | None = None
    confidence: int = Field(ge=0, le=100)


class ScoreAnalysisResult(BaseModel):
    source_format: str
    conversion_required: bool = False
    parser_used: str
    voices: list[VoicePartSummary]
    warnings: list[str] = Field(default_factory=list)


class ScoreUploadAnalysisResponse(ScoreUploadResponse):
    analysis: ScoreAnalysisResult | None = None


class PracticeLogCreate(BaseModel):
    singer_name: str
    voice_part: str
    completion: int = Field(ge=0, le=100)
    feedback: str
    score_title: str


class PracticeLogResponse(PracticeLogCreate):
    id: str
    recorded_at: datetime
