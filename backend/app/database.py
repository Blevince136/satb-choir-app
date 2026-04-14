from __future__ import annotations

import copy
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ReturnDocument

from app.config import settings

client: AsyncIOMotorClient | None = None
ACTIVE_STORAGE_BACKEND = "file"
MIGRATION_VERSION = 1

STORAGE_ROOT = Path(__file__).resolve().parents[1] / "storage"
AUTH_ROOT = STORAGE_ROOT / "auth"
SCORES_ROOT = STORAGE_ROOT / "scores"
PRACTICE_ROOT = STORAGE_ROOT / "practice"
APP_STATE_FILE = STORAGE_ROOT / "app_state.json"

for directory in (AUTH_ROOT, SCORES_ROOT, PRACTICE_ROOT):
    directory.mkdir(parents=True, exist_ok=True)


def _load_json_records(target_file: Path) -> list[dict[str, Any]]:
    if not target_file.exists():
        return []
    try:
        payload = json.loads(target_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    return [item for item in payload if isinstance(item, dict)]


def _save_json_records(target_file: Path, records: list[dict[str, Any]]) -> None:
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(json.dumps(records, indent=2), encoding="utf-8")


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


def _matches(document: dict[str, Any], query: dict[str, Any]) -> bool:
    return all(document.get(key) == value for key, value in query.items())


def _apply_projection(document: dict[str, Any], projection: dict[str, int] | None) -> dict[str, Any]:
    if not projection:
        return copy.deepcopy(document)
    include_keys = {key for key, value in projection.items() if value}
    if include_keys:
        return {key: copy.deepcopy(value) for key, value in document.items() if key in include_keys}
    excluded = {key for key, value in projection.items() if not value}
    return {key: copy.deepcopy(value) for key, value in document.items() if key not in excluded}


def _apply_update(document: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    updated = copy.deepcopy(document)
    for key, value in update.get("$set", {}).items():
        updated[key] = value
    for key in update.get("$unset", {}).keys():
        updated.pop(key, None)
    return updated


class FileCursor:
    def __init__(self, items: list[dict[str, Any]]):
        self._items = items
        self._index = 0

    def sort(self, field: str, direction: int):
        reverse = direction < 0
        self._items.sort(key=lambda item: item.get(field, ""), reverse=reverse)
        return self

    async def to_list(self, length: int | None = None) -> list[dict[str, Any]]:
        if length is None:
            return [copy.deepcopy(item) for item in self._items]
        return [copy.deepcopy(item) for item in self._items[:length]]

    def __aiter__(self):
        self._index = 0
        return self

    async def __anext__(self):
        if self._index >= len(self._items):
            raise StopAsyncIteration
        item = copy.deepcopy(self._items[self._index])
        self._index += 1
        return item


class FileCollection:
    def __init__(self, target_file: Path):
        self.target_file = target_file

    def _load(self) -> list[dict[str, Any]]:
        return _load_json_records(self.target_file)

    def _save(self, records: list[dict[str, Any]]) -> None:
        _save_json_records(self.target_file, records)

    async def find_one(self, query: dict[str, Any]) -> dict[str, Any] | None:
        for item in self._load():
            if _matches(item, query):
                return copy.deepcopy(item)
        return None

    async def replace_one(self, query: dict[str, Any], replacement: dict[str, Any], upsert: bool = False) -> None:
        records = self._load()
        for index, item in enumerate(records):
            if _matches(item, query):
                records[index] = copy.deepcopy(replacement)
                self._save(records)
                return
        if upsert:
            records.append(copy.deepcopy(replacement))
            self._save(records)

    async def insert_one(self, document: dict[str, Any]) -> None:
        records = self._load()
        records.append(copy.deepcopy(document))
        self._save(records)

    async def update_one(self, query: dict[str, Any], update: dict[str, Any]) -> None:
        records = self._load()
        for index, item in enumerate(records):
            if _matches(item, query):
                records[index] = _apply_update(item, update)
                self._save(records)
                return

    def find(self, query: dict[str, Any], projection: dict[str, int] | None = None) -> FileCursor:
        items = [
            _apply_projection(item, projection)
            for item in self._load()
            if _matches(item, query)
        ]
        return FileCursor(items)

    async def delete_one(self, query: dict[str, Any]) -> None:
        records = self._load()
        remaining = [item for item in records if not _matches(item, query)]
        if len(remaining) != len(records):
            self._save(remaining)

    async def count_documents(self, query: dict[str, Any]) -> int:
        return sum(1 for item in self._load() if _matches(item, query))

    async def create_index(self, *args: Any, **kwargs: Any) -> None:
        return None

    async def find_one_and_update(
        self,
        query: dict[str, Any],
        update: dict[str, Any],
        return_document: ReturnDocument | None = None,
    ) -> dict[str, Any] | None:
        records = self._load()
        for index, item in enumerate(records):
            if _matches(item, query):
                updated = _apply_update(item, update)
                records[index] = updated
                self._save(records)
                if return_document == ReturnDocument.AFTER:
                    return copy.deepcopy(updated)
                return copy.deepcopy(item)
        return None


USERS_FILE = AUTH_ROOT / "users.json"
SESSIONS_FILE = AUTH_ROOT / "sessions.json"
SCORES_INDEX_FILE = SCORES_ROOT / "index.json"
PRACTICE_INDEX_FILE = PRACTICE_ROOT / "index.json"
APP_STATE_INDEX_FILE = APP_STATE_FILE


def get_file_users_collection() -> FileCollection:
    return FileCollection(USERS_FILE)


def get_file_sessions_collection() -> FileCollection:
    return FileCollection(SESSIONS_FILE)


def get_file_scores_collection() -> FileCollection:
    return FileCollection(SCORES_INDEX_FILE)


def get_file_practice_collection() -> FileCollection:
    return FileCollection(PRACTICE_INDEX_FILE)


def get_file_app_state_collection() -> FileCollection:
    return FileCollection(APP_STATE_INDEX_FILE)


def _using_mongodb() -> bool:
    return ACTIVE_STORAGE_BACKEND == "mongodb"


def get_app_state_collection():
    if _using_mongodb():
        return get_database()["app_state"]
    return get_file_app_state_collection()


async def _migrate_json_storage_to_mongo() -> None:
    migration_state = mongo_to_dict(await get_app_state_collection().find_one({"id": "legacy-json-migration"}))
    if migration_state and migration_state.get("version") == MIGRATION_VERSION:
        return

    users = _load_json_records(USERS_FILE)
    sessions = _load_json_records(SESSIONS_FILE)
    scores = _load_json_records(SCORES_INDEX_FILE)
    practice = _load_json_records(PRACTICE_INDEX_FILE)

    if users:
        for item in users:
            await get_users_collection().replace_one({"id": item.get("id")}, item, upsert=True)

    if sessions:
        for item in sessions:
            await get_sessions_collection().replace_one({"token_hash": item.get("token_hash")}, item, upsert=True)

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
    global client, ACTIVE_STORAGE_BACKEND

    requested_backend = settings.storage_backend.lower().strip()
    wants_file = requested_backend == "file"
    wants_mongo = requested_backend == "mongodb"
    wants_auto = requested_backend == "auto"

    if wants_file:
        ACTIVE_STORAGE_BACKEND = "file"
        client = None
        return

    if not settings.mongodb_uri.strip():
        if wants_mongo:
            raise RuntimeError("MONGODB_URI is required when STORAGE_BACKEND=mongodb.")
        ACTIVE_STORAGE_BACKEND = "file"
        client = None
        return

    try:
        client = AsyncIOMotorClient(settings.mongodb_uri)
        await client.admin.command("ping")
        ACTIVE_STORAGE_BACKEND = "mongodb"
        await _ensure_indexes()
        await _migrate_json_storage_to_mongo()
    except Exception:
        if wants_auto:
            client = None
            ACTIVE_STORAGE_BACKEND = "file"
            return
        raise


async def close_mongo_connection() -> None:
    global client
    if client is not None:
        client.close()
        client = None


def get_database() -> AsyncIOMotorDatabase:
    if client is None:
        raise RuntimeError("MongoDB client is not connected.")
    return client[settings.mongodb_db_name]


def get_users_collection():
    if _using_mongodb():
        return get_database()["users"]
    return get_file_users_collection()


def get_sessions_collection():
    if _using_mongodb():
        return get_database()["sessions"]
    return get_file_sessions_collection()


def get_scores_collection():
    if _using_mongodb():
        return get_database()["scores"]
    return get_file_scores_collection()


def get_practice_collection():
    if _using_mongodb():
        return get_database()["practice_recordings"]
    return get_file_practice_collection()


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
    if _using_mongodb():
        migration_state = mongo_to_dict(await get_app_state_collection().find_one({"id": "legacy-json-migration"}))
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

    return {
        "backend": "file",
        "database_name": "local-json-storage",
        "mongodb_uri": "",
        "migration_version": None,
        "migration_completed": False,
        "legacy_json_files_remaining": [str(path) for path in _legacy_json_sources() if path.exists()],
        "archived_legacy_json_files": [],
        "archive_skipped": [],
        "counts": {
            "users": await get_users_collection().count_documents({}),
            "sessions": await get_sessions_collection().count_documents({}),
            "scores": await get_scores_collection().count_documents({}),
            "practice_recordings": await get_practice_collection().count_documents({}),
        },
    }
