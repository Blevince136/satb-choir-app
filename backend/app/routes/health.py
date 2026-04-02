from fastapi import APIRouter

from app.ml.inference import get_model_status
from app.schemas import AiModelStatusResponse, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse()


@router.get("/ai/status", response_model=AiModelStatusResponse)
async def ai_status() -> AiModelStatusResponse:
    return AiModelStatusResponse(**get_model_status())
