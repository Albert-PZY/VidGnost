#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


RE_REQUIREMENT = re.compile(r"^### Requirement:", re.MULTILINE)
RE_SCENARIO = re.compile(r"^#### Scenario:", re.MULTILINE)
RE_TASK_ITEM = re.compile(r"^- \[(?: |x|X)\] ", re.MULTILINE)


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _find_active_changes(changes_dir: Path) -> list[Path]:
    if not changes_dir.exists():
        return []
    ignored = {"archive", "templates"}
    return sorted(
        [
            item
            for item in changes_dir.iterdir()
            if item.is_dir() and item.name not in ignored
        ],
        key=lambda p: p.name,
    )


def _validate_spec_file(path: Path, errors: list[str]) -> None:
    try:
        content = _read_text(path)
    except OSError as exc:
        errors.append(f"{path}: unreadable ({exc})")
        return
    if not RE_REQUIREMENT.search(content):
        errors.append(f"{path}: missing '### Requirement:' block")
    if not RE_SCENARIO.search(content):
        errors.append(f"{path}: missing '#### Scenario:' block")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    openspec_dir = repo_root / "docs" / "openspec"
    changes_dir = openspec_dir / "changes"
    base_specs_dir = openspec_dir / "specs"

    errors: list[str] = []
    warnings: list[str] = []
    capabilities: set[str] = set()

    active_changes = _find_active_changes(changes_dir)
    if not active_changes:
        errors.append("No active change found under docs/openspec/changes.")

    required_files = (".openspec.yaml", "proposal.md", "design.md", "tasks.md")
    for change in active_changes:
        for required_name in required_files:
            required_path = change / required_name
            if not required_path.exists():
                errors.append(f"{change}: missing {required_name}")
        tasks_path = change / "tasks.md"
        if tasks_path.exists():
            tasks_content = _read_text(tasks_path)
            if not RE_TASK_ITEM.search(tasks_content):
                warnings.append(f"{tasks_path}: no checklist items detected")

        specs_dir = change / "specs"
        if not specs_dir.exists():
            errors.append(f"{change}: missing specs directory")
            continue

        spec_capability_dirs = sorted([item for item in specs_dir.iterdir() if item.is_dir()], key=lambda p: p.name)
        if not spec_capability_dirs:
            errors.append(f"{specs_dir}: no capability directories found")
            continue

        for capability_dir in spec_capability_dirs:
            capability = capability_dir.name
            capabilities.add(capability)
            spec_path = capability_dir / "spec.md"
            if not spec_path.exists():
                errors.append(f"{capability_dir}: missing spec.md")
                continue
            _validate_spec_file(spec_path, errors)

    if not base_specs_dir.exists():
        errors.append(f"Missing base specs directory: {base_specs_dir}")
    else:
        for capability in sorted(capabilities):
            base_spec = base_specs_dir / capability / "spec.md"
            if not base_spec.exists():
                errors.append(
                    f"Missing base spec for capability '{capability}': {base_spec}. "
                    "Promote stable requirements from active change into base specs."
                )
                continue
            _validate_spec_file(base_spec, errors)

    if warnings:
        print("OpenSpec warnings:")
        for warning in warnings:
            print(f"  - {warning}")

    if errors:
        print("OpenSpec check failed:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(
        "OpenSpec check passed. "
        f"Active changes: {len(active_changes)}, capabilities checked: {len(capabilities)}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
