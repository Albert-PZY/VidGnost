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

PromptTemplateChannel = Literal["summary", "mindmap"]


class PromptTemplatePayload(TypedDict):
    id: str
    channel: PromptTemplateChannel
    name: str
    content: str
    is_default: bool
    created_at: datetime
    updated_at: datetime


class PromptTemplateBundle(TypedDict):
    summary_templates: list[PromptTemplatePayload]
    mindmap_templates: list[PromptTemplatePayload]
    selected_summary_template_id: str
    selected_mindmap_template_id: str


_DEFAULT_TEMPLATE_NAMES: dict[PromptTemplateChannel, dict[str, str]] = {
    "summary": {
        "default": "Default Notes",
        "course": "Course Notes",
        "interview": "Interview Notes",
    },
    "mindmap": {
        "default": "Default Mindmap",
        "course": "Course Mindmap",
        "interview": "Interview Mindmap",
    },
}

SUMMARY_PROMPT_TEMPLATES: dict[str, str] = {
    "default": SUMMARY_PROMPT,
    "course": (
        f"{SUMMARY_PROMPT}\n\n"
        "补充要求：\n"
        "1) 以教学视角输出，包含学习目标、知识点拆解、关键术语释义。\n"
        "2) 给出可执行的复习清单与练习建议。\n"
        "3) 保留原有结构化标题层级。"
    ),
    "interview": (
        f"{SUMMARY_PROMPT}\n\n"
        "补充要求：\n"
        "1) 以访谈分析视角输出，强调观点、证据、分歧点。\n"
        "2) 输出可追问的问题列表与后续行动建议。\n"
        "3) 保留原有结构化标题层级。"
    ),
}

MINDMAP_PROMPT_TEMPLATES: dict[str, str] = {
    "default": MINDMAP_PROMPT,
    "course": (
        f"{MINDMAP_PROMPT}\n\n"
        "补充要求：\n"
        "1) 主干优先体现课程章节与知识模块。\n"
        "2) 子节点突出定义、方法、案例。"
    ),
    "interview": (
        f"{MINDMAP_PROMPT}\n\n"
        "补充要求：\n"
        "1) 主干优先体现人物观点与主题分组。\n"
        "2) 子节点突出事实依据、争议点与行动项。"
    ),
}

_DEFAULT_TEMPLATE_IDS: dict[PromptTemplateChannel, str] = {
    "summary": "summary-default-main",
    "mindmap": "mindmap-default-main",
}

_DEFAULT_TEMPLATE_ID_PREFIXES: dict[PromptTemplateChannel, tuple[str, ...]] = {
    "summary": ("summary-default-",),
    "mindmap": ("mindmap-default-",),
}


class PromptTemplateStore:
    def __init__(self, settings: Settings) -> None:
        self._lock = asyncio.Lock()
        self._prompts_root = Path(settings.storage_dir) / "prompts"
        self._templates_dir = self._prompts_root / "templates"
        self._selection_path = self._prompts_root / "selection.json"
        self._legacy_store_path = self._prompts_root / "templates.json"
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

    async def update_selection(
        self,
        selected_summary_template_id: str,
        selected_mindmap_template_id: str,
    ) -> PromptTemplateBundle:
        async with self._lock:
            return await asyncio.to_thread(
                self._update_selection_sync,
                selected_summary_template_id,
                selected_mindmap_template_id,
            )

    async def resolve_selected_prompts(self) -> tuple[str, str]:
        bundle = await self.get_bundle()
        summary_prompt = _find_template_content(bundle["summary_templates"], bundle["selected_summary_template_id"])
        mindmap_prompt = _find_template_content(bundle["mindmap_templates"], bundle["selected_mindmap_template_id"])
        return summary_prompt, mindmap_prompt

    def _get_bundle_sync(self) -> PromptTemplateBundle:
        templates, selection = self._load_state()
        return self._build_bundle(templates, selection)

    def _create_template_sync(self, channel: PromptTemplateChannel, name: str, content: str) -> PromptTemplateBundle:
        normalized_name = name.strip()
        normalized_content = content.strip()
        if not normalized_name:
            raise ValueError("Template name is required")
        if not normalized_content:
            raise ValueError("Template content is required")
        _validate_channel(channel)

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
        fallback = next(item for item in templates if item.channel == target.channel)
        if target.channel == "summary" and selection.summary_template_id == template_id:
            selection.summary_template_id = fallback.id
        if target.channel == "mindmap" and selection.mindmap_template_id == template_id:
            selection.mindmap_template_id = fallback.id
        selection.updated_at = datetime.now(timezone.utc)
        self._write_state(templates, selection)
        return self._build_bundle(templates, selection)

    def _update_selection_sync(
        self,
        selected_summary_template_id: str,
        selected_mindmap_template_id: str,
    ) -> PromptTemplateBundle:
        summary_id = selected_summary_template_id.strip()
        mindmap_id = selected_mindmap_template_id.strip()
        if not summary_id or not mindmap_id:
            raise ValueError("Selected template ids are required")

        templates, selection = self._load_state()
        summary = next((item for item in templates if item.id == summary_id), None)
        mindmap = next((item for item in templates if item.id == mindmap_id), None)
        if summary is None or summary.channel != "summary":
            raise ValueError("Invalid summary template id")
        if mindmap is None or mindmap.channel != "mindmap":
            raise ValueError("Invalid mindmap template id")
        selection.summary_template_id = summary_id
        selection.mindmap_template_id = mindmap_id
        selection.updated_at = datetime.now(timezone.utc)
        self._write_state(templates, selection)
        return self._build_bundle(templates, selection)

    def _load_state(self) -> tuple[list[PromptTemplateRecord], PromptTemplateSelectionRecord]:
        migrated = self._migrate_legacy_file_if_needed()
        templates = self._load_templates()
        changed = migrated

        filtered_templates = [item for item in templates if not _is_legacy_seed_template(item)]
        removed_template_ids = {item.id for item in templates} - {item.id for item in filtered_templates}
        if removed_template_ids:
            changed = True
        templates = filtered_templates

        summary_templates = [item for item in templates if item.channel == "summary"]
        if not summary_templates:
            templates.extend(self._build_default_templates("summary"))
            changed = True

        mindmap_templates = [item for item in templates if item.channel == "mindmap"]
        if not mindmap_templates:
            templates.extend(self._build_default_templates("mindmap"))
            changed = True

        if self._sync_default_templates(templates):
            changed = True

        templates.sort(key=lambda item: (item.created_at, item.id))
        selection = self._load_selection()
        selection_changed = self._ensure_valid_selection(selection, templates)
        changed = changed or selection_changed

        if changed:
            self._write_state(templates, selection)
            for template_id in removed_template_ids:
                self._template_path(template_id).unlink(missing_ok=True)
        return templates, selection

    def _sync_default_templates(self, templates: list[PromptTemplateRecord]) -> bool:
        changed = False
        now = datetime.now(timezone.utc)
        for channel in ("summary", "mindmap"):
            typed_channel = cast(PromptTemplateChannel, channel)
            expected_defaults = self._build_default_templates(typed_channel)
            for expected in expected_defaults:
                target = next((item for item in templates if item.id == expected.id), None)
                if target is None:
                    templates.append(expected)
                    changed = True
                    continue
                if target.name == expected.name and target.content == expected.content:
                    continue
                target.name = expected.name
                target.content = expected.content
                target.updated_at = now
                changed = True
        return changed

    def _migrate_legacy_file_if_needed(self) -> bool:
        if not self._legacy_store_path.exists():
            return False
        if any(self._templates_dir.glob("*.json")) or self._selection_path.exists():
            self._legacy_store_path.unlink(missing_ok=True)
            return True
        try:
            payload = orjson.loads(self._legacy_store_path.read_bytes())
        except orjson.JSONDecodeError:
            self._legacy_store_path.unlink(missing_ok=True)
            return True
        if not isinstance(payload, dict):
            self._legacy_store_path.unlink(missing_ok=True)
            return True
        raw_templates = payload.get("templates", [])
        templates: list[PromptTemplateRecord] = []
        if isinstance(raw_templates, list):
            for raw in raw_templates:
                if not isinstance(raw, dict):
                    continue
                template = PromptTemplateRecord.from_dict(raw)
                if not template.id or template.channel not in {"summary", "mindmap"}:
                    continue
                templates.append(template)
        selection = PromptTemplateSelectionRecord(summary_template_id="", mindmap_template_id="")
        raw_selection = payload.get("selection")
        if isinstance(raw_selection, dict):
            selection = PromptTemplateSelectionRecord.from_dict(raw_selection)
        self._write_state(templates, selection)
        self._legacy_store_path.unlink(missing_ok=True)
        return True

    def _load_templates(self) -> list[PromptTemplateRecord]:
        templates: list[PromptTemplateRecord] = []
        for file_path in sorted(self._templates_dir.glob("*.json")):
            raw = self._read_json(file_path, default=None)
            if not isinstance(raw, dict):
                continue
            template = PromptTemplateRecord.from_dict(raw)
            if not template.id or template.channel not in {"summary", "mindmap"}:
                continue
            templates.append(template)
        return templates

    def _load_selection(self) -> PromptTemplateSelectionRecord:
        payload = self._read_json(self._selection_path, default=None)
        if isinstance(payload, dict):
            return PromptTemplateSelectionRecord.from_dict(payload)
        return PromptTemplateSelectionRecord(summary_template_id="", mindmap_template_id="")

    def _build_default_templates(self, channel: PromptTemplateChannel) -> list[PromptTemplateRecord]:
        source = SUMMARY_PROMPT_TEMPLATES if channel == "summary" else MINDMAP_PROMPT_TEMPLATES
        result: list[PromptTemplateRecord] = []
        for key, content in source.items():
            template_id = _DEFAULT_TEMPLATE_IDS[channel]
            if key != "default":
                template_id = f"{channel}-{key}"
            result.append(
                PromptTemplateRecord(
                    id=template_id,
                    channel=channel,
                    name=_DEFAULT_TEMPLATE_NAMES[channel].get(key, key),
                    content=content,
                )
            )
        return result

    def _ensure_valid_selection(
        self,
        selection: PromptTemplateSelectionRecord,
        templates: list[PromptTemplateRecord],
    ) -> bool:
        changed = False
        summary_templates = [item for item in templates if item.channel == "summary"]
        mindmap_templates = [item for item in templates if item.channel == "mindmap"]
        summary_ids = {item.id for item in summary_templates}
        mindmap_ids = {item.id for item in mindmap_templates}
        if selection.summary_template_id not in summary_ids:
            selection.summary_template_id = (
                _DEFAULT_TEMPLATE_IDS["summary"] if _DEFAULT_TEMPLATE_IDS["summary"] in summary_ids else summary_templates[0].id
            )
            changed = True
        if selection.mindmap_template_id not in mindmap_ids:
            selection.mindmap_template_id = (
                _DEFAULT_TEMPLATE_IDS["mindmap"] if _DEFAULT_TEMPLATE_IDS["mindmap"] in mindmap_ids else mindmap_templates[0].id
            )
            changed = True
        if changed:
            selection.updated_at = datetime.now(timezone.utc)
        return changed

    def _build_bundle(
        self,
        templates: list[PromptTemplateRecord],
        selection: PromptTemplateSelectionRecord,
    ) -> PromptTemplateBundle:
        templates.sort(key=lambda item: (item.created_at, item.id))
        summary_templates = [item for item in templates if item.channel == "summary"]
        mindmap_templates = [item for item in templates if item.channel == "mindmap"]
        return {
            "summary_templates": [_serialize_template(item) for item in summary_templates],
            "mindmap_templates": [_serialize_template(item) for item in mindmap_templates],
            "selected_summary_template_id": selection.summary_template_id,
            "selected_mindmap_template_id": selection.mindmap_template_id,
        }

    def _write_state(
        self,
        templates: list[PromptTemplateRecord],
        selection: PromptTemplateSelectionRecord,
    ) -> None:
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
    if channel not in {"summary", "mindmap"}:
        raise ValueError("Invalid template channel")


def _serialize_template(record: PromptTemplateRecord) -> PromptTemplatePayload:
    channel: PromptTemplateChannel = "summary" if record.channel == "summary" else "mindmap"
    return {
        "id": record.id,
        "channel": channel,
        "name": record.name,
        "content": record.content,
        "is_default": _is_default_template(record),
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def _find_template_content(templates: list[PromptTemplatePayload], template_id: str) -> str:
    for item in templates:
        if item["id"] == template_id:
            return item["content"]
    if not templates:
        raise ValueError("Template list is empty")
    return templates[0]["content"]


def _is_legacy_seed_template(record: PromptTemplateRecord) -> bool:
    legacy_name_map: dict[PromptTemplateChannel, set[str]] = {
        "summary": {"Concise Notes", "Teaching Notes"},
        "mindmap": {"Compact Mindmap", "Concept Mindmap"},
    }
    legacy_id_prefix_map: dict[PromptTemplateChannel, tuple[str, ...]] = {
        "summary": ("summary-concise-", "summary-teaching-"),
        "mindmap": ("mindmap-compact-", "mindmap-concept-"),
    }
    channel: PromptTemplateChannel = "summary" if record.channel == "summary" else "mindmap"
    if record.name in legacy_name_map[channel]:
        return True
    return any(record.id.startswith(prefix) for prefix in legacy_id_prefix_map[channel])


def _is_default_template(record: PromptTemplateRecord) -> bool:
    channel: PromptTemplateChannel = "summary" if record.channel == "summary" else "mindmap"
    return any(record.id.startswith(prefix) for prefix in _DEFAULT_TEMPLATE_ID_PREFIXES[channel])
