from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from datetime import UTC, datetime, timedelta
from pathlib import Path

from fastapi import Header, HTTPException, status

from app.schemas import UserResponse

PASSWORD_ITERATIONS = 120_000
SESSION_DURATION_DAYS = 30
AUTH_ROOT = Path(__file__).resolve().parents[2] / "storage" / "auth"
AUTH_ROOT.mkdir(parents=True, exist_ok=True)
USERS_FILE = AUTH_ROOT / "users.json"
SESSIONS_FILE = AUTH_ROOT / "sessions.json"


def _load_records(target_file: Path) -> list[dict]:
    if not target_file.exists():
        return []
    try:
        return json.loads(target_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def _save_records(target_file: Path, items: list[dict]) -> None:
    target_file.write_text(json.dumps(items, indent=2), encoding="utf-8")


def load_users() -> list[dict]:
    return _load_records(USERS_FILE)


def save_users(items: list[dict]) -> None:
    _save_records(USERS_FILE, items)


def load_sessions() -> list[dict]:
    return _load_records(SESSIONS_FILE)


def save_sessions(items: list[dict]) -> None:
    _save_records(SESSIONS_FILE, items)


def save_reset_code_for_email(email: str) -> str:
    users = load_users()
    user = next((item for item in users if item["email"] == email.lower()), None)
    if user is None:
        return ""

    reset_code = f"{secrets.randbelow(900000) + 100000}"
    user["password_reset_code_hash"] = hash_session_token(reset_code)
    user["password_reset_expires_at"] = (datetime.now(UTC) + timedelta(minutes=15)).isoformat()
    save_users(users)
    return reset_code


def reset_password_with_code(email: str, reset_code: str, new_password: str) -> None:
    validate_password_strength(new_password)
    users = load_users()
    user = next((item for item in users if item["email"] == email.lower()), None)
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

    user["password_hash"] = hash_password(new_password)
    user.pop("password_reset_code_hash", None)
    user.pop("password_reset_expires_at", None)
    save_users(users)


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
    sessions = load_sessions()
    sessions.append(
        {
            "token_hash": hash_session_token(raw_token),
            "user_id": user_id,
            "created_at": datetime.now(UTC).isoformat(),
            "expires_at": (datetime.now(UTC) + timedelta(days=SESSION_DURATION_DAYS)).isoformat(),
        }
    )
    save_sessions(sessions)
    return raw_token


async def get_current_user(authorization: str | None = Header(default=None)) -> UserResponse:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")

    token = authorization.split(" ", 1)[1].strip()
    token_hash = hash_session_token(token)
    sessions = load_sessions()
    session = next((item for item in sessions if item.get("token_hash") == token_hash), None)
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid session token.")

    expires_at_text = session.get("expires_at")
    expires_at = datetime.fromisoformat(expires_at_text) if expires_at_text else None
    if expires_at and expires_at < datetime.now(UTC):
        save_sessions([item for item in sessions if item.get("token_hash") != token_hash])
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please sign in again.")

    users = load_users()
    user = next((item for item in users if item.get("id") == session.get("user_id")), None)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Account not found for this session.")

    return UserResponse(
        id=user["id"],
        full_name=user["full_name"],
        email=user["email"],
        created_at=datetime.fromisoformat(user["created_at"]),
    )
