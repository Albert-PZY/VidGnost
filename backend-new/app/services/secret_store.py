from __future__ import annotations

import os
from pathlib import Path

import orjson
from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings

SECRET_MASK_PLACEHOLDER = "__SECRET_MASKED__"


class SecretStore:
    def __init__(self, settings: Settings) -> None:
        storage_root = Path(settings.storage_dir)
        storage_root.mkdir(parents=True, exist_ok=True)
        self._path = storage_root / "secure-secrets.json"
        self._key_path = storage_root / "secure-secrets.key"
        self._fernet = Fernet(self._load_or_create_key())

    def get(self, key: str, default: str = "") -> str:
        payload = self._read_payload()
        encrypted = payload.get("items", {}).get(key)
        if not isinstance(encrypted, str) or not encrypted:
            return default
        try:
            raw = self._fernet.decrypt(encrypted.encode("utf-8"))
            return raw.decode("utf-8")
        except (InvalidToken, OSError, ValueError):
            return default

    def set_many(self, values: dict[str, str]) -> None:
        payload = self._read_payload()
        items = payload.setdefault("items", {})
        if not isinstance(items, dict):
            items = {}
            payload["items"] = items
        for key, value in values.items():
            normalized = str(value).strip()
            if not normalized:
                items.pop(key, None)
                continue
            token = self._fernet.encrypt(normalized.encode("utf-8")).decode("utf-8")
            items[key] = token
        self._write_payload(payload)

    def is_configured(self, key: str) -> bool:
        value = self.get(key, "")
        return bool(value.strip())

    def present(self, key: str, *, reveal: bool) -> tuple[str, bool]:
        secret = self.get(key, "")
        configured = bool(secret.strip())
        if not configured:
            return ("", False)
        if reveal:
            return (secret, True)
        return (SECRET_MASK_PLACEHOLDER, True)

    def _load_or_create_key(self) -> bytes:
        if self._key_path.exists():
            key = self._key_path.read_bytes().strip()
            if key:
                return key
        key = Fernet.generate_key()
        self._key_path.write_bytes(key + b"\n")
        try:
            os.chmod(self._key_path, 0o600)
        except OSError:
            pass
        return key

    def _read_payload(self) -> dict[str, object]:
        if not self._path.exists():
            return {"version": 1, "items": {}}
        try:
            raw = orjson.loads(self._path.read_bytes())
        except orjson.JSONDecodeError:
            return {"version": 1, "items": {}}
        if not isinstance(raw, dict):
            return {"version": 1, "items": {}}
        payload = {"version": int(raw.get("version", 1)), "items": raw.get("items", {})}
        if not isinstance(payload["items"], dict):
            payload["items"] = {}
        return payload

    def _write_payload(self, payload: dict[str, object]) -> None:
        self._path.write_bytes(orjson.dumps(payload, option=orjson.OPT_INDENT_2))
        try:
            os.chmod(self._path, 0o600)
        except OSError:
            pass
