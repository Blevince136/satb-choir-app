from fastapi import APIRouter

from app.database import get_storage_status
from app.ml.inference import get_model_status
from app.schemas import AiModelStatusResponse, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    return HealthResponse()


@router.get("/ai/status", response_model=AiModelStatusResponse)
async def ai_status() -> AiModelStatusResponse:
    return AiModelStatusResponse(**get_model_status())


@router.get("/storage/status")
async def storage_status() -> dict:
    return await get_storage_status()
