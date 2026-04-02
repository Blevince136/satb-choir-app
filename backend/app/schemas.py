from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str = "satb-choir-api"


class AiModelStatusResponse(BaseModel):
    status: str
    classifier_enabled: bool
    model_available: bool
    model_backend: str
    model_path: str
    note: str


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
    audio_cache_ready: bool = False
    audio_cache_tempo: int | None = None
    owner_id: str | None = Field(default=None, exclude=True)


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
    prepared_source_path: str | None = None
    voices: list[VoicePartSummary]
    warnings: list[str] = Field(default_factory=list)


class ScoreUploadAnalysisResponse(ScoreUploadResponse):
    analysis: ScoreAnalysisResult | None = None


class ScoreUpdateRequest(BaseModel):
    title: str = Field(min_length=1)
    composer: str = Field(min_length=1)


class UserRegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ForgotPasswordResponse(BaseModel):
    message: str
    reset_code: str | None = None


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    reset_code: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)


class UserResponse(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    created_at: datetime


class AuthSessionResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class PracticeLogCreate(BaseModel):
    singer_name: str
    voice_part: str
    completion: int = Field(ge=0, le=100)
    feedback: str
    score_title: str


class PracticeLogResponse(PracticeLogCreate):
    id: str
    recorded_at: datetime


class PracticeRecordingResponse(BaseModel):
    id: str
    owner_id: str = Field(exclude=True)
    score_id: str
    score_title: str
    voice_part: str
    recording_uri: str
    duration_ms: int = Field(ge=0)
    accuracy_percent: int = Field(ge=0, le=100)
    feedback: str
    analysis_method: str
    reference_duration_ms: int = Field(ge=0)
    recorded_at: datetime
