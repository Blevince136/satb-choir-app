from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas import (
    AuthSessionResponse,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    ResetPasswordRequest,
    UserLoginRequest,
    UserRegisterRequest,
    UserResponse,
)
from app.database import get_users_collection, mongo_to_dict
from app.services.auth_service import (
    create_session_token,
    get_current_user,
    hash_password,
    reset_password_with_code,
    save_reset_code_for_email,
    validate_password_strength,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=AuthSessionResponse, status_code=status.HTTP_201_CREATED)
async def sign_up(payload: UserRegisterRequest) -> AuthSessionResponse:
    validate_password_strength(payload.password)
    existing_user = mongo_to_dict(
        await get_users_collection().find_one({"email": payload.email.lower()})
    )
    if existing_user:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    user_id = str(uuid4())
    now = datetime.now(UTC)
    await get_users_collection().insert_one(
        {
            "id": user_id,
            "full_name": payload.full_name.strip(),
            "email": payload.email.lower(),
            "password_hash": hash_password(payload.password),
            "created_at": now.isoformat(),
        }
    )

    access_token = await create_session_token(user_id)
    return AuthSessionResponse(
        access_token=access_token,
        user=UserResponse(
            id=user_id,
            full_name=payload.full_name.strip(),
            email=payload.email.lower(),
            created_at=now,
        ),
    )


@router.post("/signin", response_model=AuthSessionResponse)
async def sign_in(payload: UserLoginRequest) -> AuthSessionResponse:
    user = mongo_to_dict(await get_users_collection().find_one({"email": payload.email.lower()}))
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Incorrect email or password.")

    access_token = await create_session_token(str(user["id"]))
    return AuthSessionResponse(
        access_token=access_token,
        user=UserResponse(
            id=str(user["id"]),
            full_name=user["full_name"],
            email=user["email"],
            created_at=datetime.fromisoformat(user["created_at"]),
        ),
    )


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: UserResponse = Depends(get_current_user)) -> UserResponse:
    return current_user


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(payload: ForgotPasswordRequest) -> ForgotPasswordResponse:
    reset_code = await save_reset_code_for_email(payload.email)
    return ForgotPasswordResponse(
        message="If this account exists, a reset code has been generated.",
        reset_code=reset_code or None,
    )


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordRequest) -> dict[str, str]:
    await reset_password_with_code(payload.email, payload.reset_code, payload.new_password)
    return {"message": "Password reset successful. You can now sign in."}
