from __future__ import annotations

import hashlib
import hmac
import re
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Header, HTTPException, status

from app.database import get_sessions_collection, get_users_collection, mongo_to_dict
from app.schemas import UserResponse

PASSWORD_ITERATIONS = 120_000
SESSION_DURATION_DAYS = 30


async def save_reset_code_for_email(email: str) -> str:
    user = mongo_to_dict(await get_users_collection().find_one({"email": email.lower()}))
    if user is None:
        return ""

    reset_code = f"{secrets.randbelow(900000) + 100000}"
    await get_users_collection().update_one(
        {"id": user["id"]},
        {
            "$set": {
                "password_reset_code_hash": hash_session_token(reset_code),
                "password_reset_expires_at": (datetime.now(UTC) + timedelta(minutes=15)).isoformat(),
            }
        },
    )
    return reset_code


async def reset_password_with_code(email: str, reset_code: str, new_password: str) -> None:
    validate_password_strength(new_password)
    user = mongo_to_dict(await get_users_collection().find_one({"email": email.lower()}))
    if user is None:
        raise HTTPException(status_code=404, detail="Account not found.")

    expires_at_text = user.get("password_reset_expires_at")
    reset_hash = user.get("password_reset_code_hash")
    if not expires_at_text or not reset_hash:
        raise HTTPException(status_code=400, detail="No reset request is active for this account.")

    expires_at = datetime.fromisoformat(expires_at_text)
    if expires_at < datetime.now(UTC):
        raise HTTPException(status_code=400, detail="The reset code has expired. Request a new one.")

    if hash_session_token(reset_code.strip()) != reset_hash:
        raise HTTPException(status_code=400, detail="The reset code is invalid.")

    await get_users_collection().update_one(
        {"id": user["id"]},
        {
            "$set": {"password_hash": hash_password(new_password)},
            "$unset": {
                "password_reset_code_hash": "",
                "password_reset_expires_at": "",
            },
        },
    )


def validate_password_strength(password: str) -> None:
    checks = [
        (len(password) >= 8, "at least 8 characters"),
        (re.search(r"[A-Z]", password) is not None, "an uppercase letter"),
        (re.search(r"[a-z]", password) is not None, "a lowercase letter"),
        (re.search(r"\d", password) is not None, "a number"),
        (re.search(r"[^A-Za-z0-9]", password) is not None, "a special character"),
    ]
    missing = [label for ok, label in checks if not ok]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Password must contain {', '.join(missing)}.",
        )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"{PASSWORD_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, hashed_password: str) -> bool:
    try:
        iterations_text, salt_hex, digest_hex = hashed_password.split("$", 2)
        iterations = int(iterations_text)
        salt = bytes.fromhex(salt_hex)
        expected_digest = bytes.fromhex(digest_hex)
    except (TypeError, ValueError):
        return False

    computed_digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(computed_digest, expected_digest)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


async def create_session_token(user_id: str) -> str:
    raw_token = secrets.token_urlsafe(48)
    await get_sessions_collection().insert_one(
        {
            "id": secrets.token_hex(12),
            "token_hash": hash_session_token(raw_token),
            "user_id": user_id,
            "created_at": datetime.now(UTC).isoformat(),
            "expires_at": (datetime.now(UTC) + timedelta(days=SESSION_DURATION_DAYS)).isoformat(),
        }
    )
    return raw_token


async def get_current_user(authorization: str | None = Header(default=None)) -> UserResponse:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    token = authorization.split(" ", 1)[1].strip()
    token_hash = hash_session_token(token)
    session = mongo_to_dict(await get_sessions_collection().find_one({"token_hash": token_hash}))
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token.")

    expires_at_text = session.get("expires_at")
    expires_at = datetime.fromisoformat(expires_at_text) if expires_at_text else None
    if expires_at and expires_at < datetime.now(UTC):
        await get_sessions_collection().delete_one({"token_hash": token_hash})
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please sign in again.")

    user = mongo_to_dict(await get_users_collection().find_one({"id": session.get("user_id")}))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found for this session.")

    return UserResponse(
        id=user["id"],
        full_name=user["full_name"],
        email=user["email"],
        created_at=datetime.fromisoformat(user["created_at"]),
    )
