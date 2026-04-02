from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorCollection, AsyncIOMotorDatabase

from app.config import settings

client: AsyncIOMotorClient | None = None
MIGRATION_VERSION = 1

STORAGE_ROOT = Path(__file__).resolve().parents[1] / "storage"
AUTH_ROOT = STORAGE_ROOT / "auth"
SCORES_ROOT = STORAGE_ROOT / "scores"
PRACTICE_ROOT = STORAGE_ROOT / "practice"


def _load_json_records(target_file: Path) -> list[dict[str, Any]]:
    if not target_file.exists():
        return []
    try:
        payload = json.loads(target_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [item for item in payload if isinstance(item, dict)]


def _normalize_mongo_document(document: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(document)
    normalized.pop("_id", None)
    return normalized


def _legacy_json_sources() -> list[Path]:
    return [
        AUTH_ROOT / "users.json",
        AUTH_ROOT / "sessions.json",
        SCORES_ROOT / "index.json",
        PRACTICE_ROOT / "index.json",
    ]


def _archive_legacy_json(target_file: Path) -> str | None:
    if not target_file.exists():
        return None
    archived_path = target_file.with_suffix(f"{target_file.suffix}.migrated")
    if archived_path.exists():
        return None
    try:
        target_file.replace(archived_path)
        return None
    except PermissionError:
        return str(target_file)


def get_app_state_collection() -> AsyncIOMotorCollection:
    return get_database()["app_state"]


async def _migrate_json_storage_to_mongo() -> None:
    migration_state = mongo_to_dict(
        await get_app_state_collection().find_one({"id": "legacy-json-migration"})
    )
    if migration_state and migration_state.get("version") == MIGRATION_VERSION:
        return

    users = _load_json_records(AUTH_ROOT / "users.json")
    sessions = _load_json_records(AUTH_ROOT / "sessions.json")
    scores = _load_json_records(SCORES_ROOT / "index.json")
    practice = _load_json_records(PRACTICE_ROOT / "index.json")

    if users:
        for item in users:
            await get_users_collection().replace_one({"id": item.get("id")}, item, upsert=True)

    if sessions:
        for item in sessions:
            await get_sessions_collection().replace_one(
                {"token_hash": item.get("token_hash")},
                item,
                upsert=True,
            )

    if scores:
        for item in scores:
            await get_scores_collection().replace_one({"id": item.get("id")}, item, upsert=True)

    if practice:
        for item in practice:
            await get_practice_collection().replace_one({"id": item.get("id")}, item, upsert=True)

    archive_skipped: list[str] = []
    for source in _legacy_json_sources():
        skipped_path = _archive_legacy_json(source)
        if skipped_path:
            archive_skipped.append(skipped_path)

    await get_app_state_collection().replace_one(
        {"id": "legacy-json-migration"},
        {
            "id": "legacy-json-migration",
            "version": MIGRATION_VERSION,
            "migrated_at": datetime.now(UTC).isoformat(),
            "sources_found": [str(path) for path in _legacy_json_sources() if path.exists()],
            "archive_skipped": archive_skipped,
        },
        upsert=True,
    )


async def connect_to_mongo() -> None:
    global client
    client = AsyncIOMotorClient(settings.mongodb_uri)
    await client.admin.command("ping")
    await _ensure_indexes()
    await _migrate_json_storage_to_mongo()


async def close_mongo_connection() -> None:
    global client
    if client is not None:
        client.close()
        client = None


def get_database() -> AsyncIOMotorDatabase:
    if client is None:
        raise RuntimeError("MongoDB client is not connected.")
    return client[settings.mongodb_db_name]


def get_users_collection() -> AsyncIOMotorCollection:
    return get_database()["users"]


def get_sessions_collection() -> AsyncIOMotorCollection:
    return get_database()["sessions"]


def get_scores_collection() -> AsyncIOMotorCollection:
    return get_database()["scores"]


def get_practice_collection() -> AsyncIOMotorCollection:
    return get_database()["practice_recordings"]


async def _ensure_indexes() -> None:
    await get_users_collection().create_index("id", unique=True)
    await get_users_collection().create_index("email", unique=True)
    await get_sessions_collection().create_index("token_hash", unique=True)
    await get_sessions_collection().create_index("user_id")
    await get_scores_collection().create_index("id", unique=True)
    await get_scores_collection().create_index([("owner_id", 1), ("uploaded_at", -1)])
    await get_practice_collection().create_index("id", unique=True)
    await get_practice_collection().create_index([("owner_id", 1), ("recorded_at", -1)])
    await get_app_state_collection().create_index("id", unique=True)


def mongo_to_dict(document: dict[str, Any] | None) -> dict[str, Any] | None:
    if document is None:
        return None
    return _normalize_mongo_document(document)


async def get_storage_status() -> dict[str, Any]:
    migration_state = mongo_to_dict(
        await get_app_state_collection().find_one({"id": "legacy-json-migration"})
    )
    legacy_json_files = [str(path) for path in _legacy_json_sources() if path.exists()]
    archived_json_files = [
        str(path.with_suffix(f"{path.suffix}.migrated"))
        for path in _legacy_json_sources()
        if path.with_suffix(f"{path.suffix}.migrated").exists()
    ]
    return {
        "backend": "mongodb",
        "database_name": settings.mongodb_db_name,
        "mongodb_uri": settings.mongodb_uri,
        "migration_version": migration_state.get("version") if migration_state else None,
        "migration_completed": bool(migration_state),
        "legacy_json_files_remaining": legacy_json_files,
        "archived_legacy_json_files": archived_json_files,
        "archive_skipped": migration_state.get("archive_skipped", []) if migration_state else [],
        "counts": {
            "users": await get_users_collection().count_documents({}),
            "sessions": await get_sessions_collection().count_documents({}),
            "scores": await get_scores_collection().count_documents({}),
            "practice_recordings": await get_practice_collection().count_documents({}),
        },
    }
