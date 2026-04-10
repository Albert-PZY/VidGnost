from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, TypedDict, cast

import orjson

from app.config import Settings
from app.models import PromptTemplateRecord, PromptTemplateSelectionRecord
from app.services.naming import generate_time_key
from app.services.prompt_constants import MINDMAP_PROMPT, SUMMARY_PROMPT

PromptTemplateChannel = Literal["correction", "notes", "mindmap", "vqa"]
ALL_CHANNELS: tuple[PromptTemplateChannel, ...] = ("correction", "notes", "mindmap", "vqa")


class PromptTemplatePayload(TypedDict):
    id: str
    channel: PromptTemplateChannel
    name: str
    content: str
    is_default: bool
    created_at: datetime
    updated_at: datetime


class PromptTemplateBundle(TypedDict):
    templates: list[PromptTemplatePayload]
    selection: dict[PromptTemplateChannel, str]


_DEFAULT_TEMPLATE_IDS: dict[PromptTemplateChannel, str] = {
    "correction": "correction-default-main",
    "notes": "summary-default-main",
    "mindmap": "mindmap-default-main",
    "vqa": "vqa-default-main",
}

_DEFAULT_TEMPLATE_NAMES: dict[PromptTemplateChannel, str] = {
    "correction": "Default Correction",
    "notes": "Default Notes",
    "mindmap": "Default Mindmap",
    "vqa": "Default VQA",
}

_DEFAULT_TEMPLATE_CONTENT: dict[PromptTemplateChannel, str] = {
    "correction": "请纠正转写文本中的错字与标点，保持原意。\n\n{text}",
    "notes": SUMMARY_PROMPT,
    "mindmap": MINDMAP_PROMPT,
    "vqa": "请基于证据回答用户问题，给出时间锚点与来源。\n\n问题：{query}\n证据：{context}",
}

SUMMARY_PROMPT_TEMPLATES: dict[str, str] = {
    "default": SUMMARY_PROMPT,
}

MINDMAP_PROMPT_TEMPLATES: dict[str, str] = {
    "default": MINDMAP_PROMPT,
}


class PromptTemplateStore:
    def __init__(self, settings: Settings) -> None:
        self._lock = asyncio.Lock()
        self._prompts_root = Path(settings.storage_dir) / "prompts"
        self._templates_dir = self._prompts_root / "templates"
        self._selection_path = self._prompts_root / "selection.json"
        self._prompts_root.mkdir(parents=True, exist_ok=True)
        self._templates_dir.mkdir(parents=True, exist_ok=True)

    async def get_bundle(self) -> PromptTemplateBundle:
        async with self._lock:
            return await asyncio.to_thread(self._get_bundle_sync)

    async def create_template(self, channel: PromptTemplateChannel, name: str, content: str) -> PromptTemplateBundle:
        async with self._lock:
            return await asyncio.to_thread(self._create_template_sync, channel, name, content)

    async def update_template(self, template_id: str, name: str, content: str) -> PromptTemplateBundle:
        async with self._lock:
            return await asyncio.to_thread(self._update_template_sync, template_id, name, content)

    async def delete_template(self, template_id: str) -> PromptTemplateBundle:
        async with self._lock:
            return await asyncio.to_thread(self._delete_template_sync, template_id)

    async def update_selection(self, selection: dict[PromptTemplateChannel, str]) -> PromptTemplateBundle:
        async with self._lock:
            return await asyncio.to_thread(self._update_selection_sync, selection)

    async def resolve_selected_prompts(self) -> tuple[str, str]:
        bundle = await self.get_bundle()
        template_map = {item["id"]: item["content"] for item in bundle["templates"]}
        selected_notes = bundle["selection"].get("notes", "")
        selected_mindmap = bundle["selection"].get("mindmap", "")
        notes_prompt = template_map.get(selected_notes, _DEFAULT_TEMPLATE_CONTENT["notes"])
        mindmap_prompt = template_map.get(selected_mindmap, _DEFAULT_TEMPLATE_CONTENT["mindmap"])
        return notes_prompt, mindmap_prompt

    def _get_bundle_sync(self) -> PromptTemplateBundle:
        templates, selection = self._load_state()
        return self._build_bundle(templates, selection)

    def _create_template_sync(self, channel: PromptTemplateChannel, name: str, content: str) -> PromptTemplateBundle:
        normalized_name = name.strip()
        normalized_content = content.strip()
        _validate_channel(channel)
        if not normalized_name:
            raise ValueError("Template name is required")
        if not normalized_content:
            raise ValueError("Template content is required")

        templates, selection = self._load_state()
        template_id = generate_time_key(
            f"{channel}-template",
            exists=lambda candidate: any(item.id == candidate for item in templates),
        )
        templates.append(
            PromptTemplateRecord(
                id=template_id,
                channel=channel,
                name=normalized_name,
                content=normalized_content,
            )
        )
        templates.sort(key=lambda item: (item.created_at, item.id))
        self._write_state(templates, selection)
        return self._build_bundle(templates, selection)

    def _update_template_sync(self, template_id: str, name: str, content: str) -> PromptTemplateBundle:
        normalized_name = name.strip()
        normalized_content = content.strip()
        if not normalized_name:
            raise ValueError("Template name is required")
        if not normalized_content:
            raise ValueError("Template content is required")

        templates, selection = self._load_state()
        target = next((item for item in templates if item.id == template_id), None)
        if target is None:
            raise ValueError("Template not found")
        if _is_default_template(target):
            raise ValueError("Default template is read-only")
        target.name = normalized_name
        target.content = normalized_content
        target.updated_at = datetime.now(timezone.utc)
        self._write_state(templates, selection)
        return self._build_bundle(templates, selection)

    def _delete_template_sync(self, template_id: str) -> PromptTemplateBundle:
        templates, selection = self._load_state()
        target = next((item for item in templates if item.id == template_id), None)
        if target is None:
            raise ValueError("Template not found")
        if _is_default_template(target):
            raise ValueError("Default template is read-only")

        channel_templates = [item for item in templates if item.channel == target.channel]
        if len(channel_templates) <= 1:
            raise ValueError("At least one template must remain in this channel")

        templates = [item for item in templates if item.id != template_id]
        self._repair_selection(selection, templates)
        self._write_state(templates, selection)
        return self._build_bundle(templates, selection)

    def _update_selection_sync(self, selection_updates: dict[PromptTemplateChannel, str]) -> PromptTemplateBundle:
        templates, selection = self._load_state()
        template_ids = {item.id for item in templates}
        for channel, template_id in selection_updates.items():
            if channel not in ALL_CHANNELS:
                continue
            normalized_id = str(template_id or "").strip()
            if not normalized_id:
                continue
            if normalized_id not in template_ids:
                raise ValueError(f"Invalid template id for channel {channel}: {normalized_id}")
            if channel == "correction":
                selection.correction_template_id = normalized_id
            elif channel == "notes":
                selection.notes_template_id = normalized_id
            elif channel == "mindmap":
                selection.mindmap_template_id = normalized_id
            elif channel == "vqa":
                selection.vqa_template_id = normalized_id
        selection.updated_at = datetime.now(timezone.utc)
        self._repair_selection(selection, templates)
        self._write_state(templates, selection)
        return self._build_bundle(templates, selection)

    def _load_state(self) -> tuple[list[PromptTemplateRecord], PromptTemplateSelectionRecord]:
        templates = self._load_templates()
        changed = False
        for channel in ALL_CHANNELS:
            default_id = _DEFAULT_TEMPLATE_IDS[channel]
            default_name = _DEFAULT_TEMPLATE_NAMES[channel]
            default_content = _DEFAULT_TEMPLATE_CONTENT[channel]
            target = next((item for item in templates if item.id == default_id), None)
            if target is None:
                templates.append(
                    PromptTemplateRecord(
                        id=default_id,
                        channel=channel,
                        name=default_name,
                        content=default_content,
                    )
                )
                changed = True
                continue
            if target.name != default_name or target.content != default_content:
                target.name = default_name
                target.content = default_content
                target.updated_at = datetime.now(timezone.utc)
                changed = True

        selection = self._load_selection()
        if self._repair_selection(selection, templates):
            changed = True
        if changed:
            templates.sort(key=lambda item: (item.created_at, item.id))
            self._write_state(templates, selection)
        return templates, selection

    def _repair_selection(self, selection: PromptTemplateSelectionRecord, templates: list[PromptTemplateRecord]) -> bool:
        changed = False
        id_set = {item.id for item in templates}
        fallback = {channel: _DEFAULT_TEMPLATE_IDS[channel] for channel in ALL_CHANNELS}
        channel_templates: dict[PromptTemplateChannel, list[PromptTemplateRecord]] = {channel: [] for channel in ALL_CHANNELS}
        for template in templates:
            channel = cast(PromptTemplateChannel, template.channel if template.channel in ALL_CHANNELS else "notes")
            channel_templates[channel].append(template)
        for channel in ALL_CHANNELS:
            if channel_templates[channel]:
                fallback[channel] = channel_templates[channel][0].id

        if selection.correction_template_id not in id_set:
            selection.correction_template_id = fallback["correction"]
            changed = True
        if selection.notes_template_id not in id_set:
            selection.notes_template_id = fallback["notes"]
            changed = True
        if selection.mindmap_template_id not in id_set:
            selection.mindmap_template_id = fallback["mindmap"]
            changed = True
        if selection.vqa_template_id not in id_set:
            selection.vqa_template_id = fallback["vqa"]
            changed = True
        if changed:
            selection.updated_at = datetime.now(timezone.utc)
        return changed

    def _build_bundle(
        self,
        templates: list[PromptTemplateRecord],
        selection: PromptTemplateSelectionRecord,
    ) -> PromptTemplateBundle:
        ordered = sorted(templates, key=lambda item: (item.created_at, item.id))
        serialized = [_serialize_template(item) for item in ordered]
        summary_templates = [item for item in serialized if item["channel"] == "notes"]
        mindmap_templates = [item for item in serialized if item["channel"] == "mindmap"]
        return {
            "templates": serialized,
            "selection": {
                "correction": selection.correction_template_id,
                "notes": selection.notes_template_id,
                "mindmap": selection.mindmap_template_id,
                "vqa": selection.vqa_template_id,
            },
            "summary_templates": summary_templates,  # legacy key
            "mindmap_templates": mindmap_templates,
            "selected_summary_template_id": selection.notes_template_id,
            "selected_mindmap_template_id": selection.mindmap_template_id,
        }

    def _load_templates(self) -> list[PromptTemplateRecord]:
        templates: list[PromptTemplateRecord] = []
        for file_path in sorted(self._templates_dir.glob("*.json")):
            raw = self._read_json(file_path, default=None)
            if not isinstance(raw, dict):
                continue
            template = PromptTemplateRecord.from_dict(raw)
            if not template.id or template.channel not in ALL_CHANNELS:
                continue
            templates.append(template)
        return templates

    def _load_selection(self) -> PromptTemplateSelectionRecord:
        payload = self._read_json(self._selection_path, default=None)
        if isinstance(payload, dict):
            return PromptTemplateSelectionRecord.from_dict(payload)
        return PromptTemplateSelectionRecord()

    def _write_state(self, templates: list[PromptTemplateRecord], selection: PromptTemplateSelectionRecord) -> None:
        self._templates_dir.mkdir(parents=True, exist_ok=True)
        existing_files = {path.stem: path for path in self._templates_dir.glob("*.json")}
        keep_ids: set[str] = set()
        for template in templates:
            keep_ids.add(template.id)
            self._write_json(self._template_path(template.id), template.to_dict())
        for template_id, file_path in existing_files.items():
            if template_id not in keep_ids:
                file_path.unlink(missing_ok=True)
        self._write_json(self._selection_path, selection.to_dict())

    def _template_path(self, template_id: str) -> Path:
        return self._templates_dir / f"{template_id}.json"

    @staticmethod
    def _read_json(path: Path, *, default: object) -> object:
        if not path.exists():
            return default
        try:
            return orjson.loads(path.read_bytes())
        except orjson.JSONDecodeError:
            return default

    @staticmethod
    def _write_json(path: Path, payload: object) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = path.with_suffix(path.suffix + ".tmp")
        temp_path.write_bytes(orjson.dumps(payload))
        temp_path.replace(path)


def _validate_channel(channel: str) -> None:
    if channel not in ALL_CHANNELS:
        raise ValueError("Invalid template channel")


def _serialize_template(record: PromptTemplateRecord) -> PromptTemplatePayload:
    channel = cast(PromptTemplateChannel, record.channel)
    return {
        "id": record.id,
        "channel": channel,
        "name": record.name,
        "content": record.content,
        "is_default": _is_default_template(record),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _is_default_template(record: PromptTemplateRecord) -> bool:
    return record.id in _DEFAULT_TEMPLATE_IDS.values()
