from __future__ import annotations

import ctypes
import os
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class WindowsEnvUpdateResult:
    name: str
    scope: str
    applied: bool
    message: str


class WindowsEnvManager:
    _USER_ENV_KEY = r"Environment"
    _MACHINE_ENV_KEY = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"

    def set_env_var(self, name: str, value: str, *, prefer_machine: bool = True) -> WindowsEnvUpdateResult:
        normalized_value = str(value or "").strip()
        if not normalized_value:
            raise ValueError(f"环境变量 {name} 不能为空。")

        os.environ[name] = normalized_value
        if not sys.platform.startswith("win"):
            return WindowsEnvUpdateResult(
                name=name,
                scope="process",
                applied=True,
                message=f"当前平台仅同步进程级环境变量：{name}",
            )

        return self._write_registry_value(
            name=name,
            value=normalized_value,
            prefer_machine=prefer_machine,
        )

    def prepend_path_entry(self, entry: str, *, prefer_machine: bool = True) -> WindowsEnvUpdateResult:
        normalized_entry = str(Path(entry).expanduser().resolve())
        os.environ["PATH"] = self._prepend_path_entries(os.environ.get("PATH", ""), [normalized_entry])
        if not sys.platform.startswith("win"):
            return WindowsEnvUpdateResult(
                name="Path",
                scope="process",
                applied=True,
                message=f"当前平台仅同步进程级 PATH：{normalized_entry}",
            )

        return self._update_path_registry_value(
            entry=normalized_entry,
            prefer_machine=prefer_machine,
        )

    def _write_registry_value(
        self,
        *,
        name: str,
        value: str,
        prefer_machine: bool,
    ) -> WindowsEnvUpdateResult:
        import winreg

        for root, sub_key, scope in self._iter_registry_targets(prefer_machine=prefer_machine):
            try:
                with winreg.OpenKey(root, sub_key, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as registry_key:
                    current = self._read_registry_value(registry_key, name)
                    if current != value:
                        winreg.SetValueEx(registry_key, name, 0, winreg.REG_EXPAND_SZ, value)
                self._broadcast_environment_change()
                return WindowsEnvUpdateResult(
                    name=name,
                    scope=scope,
                    applied=True,
                    message=f"{name} 已写入{self._scope_label(scope)}环境变量。",
                )
            except PermissionError:
                continue

        return WindowsEnvUpdateResult(
            name=name,
            scope="process",
            applied=False,
            message=f"{name} 仅同步到当前进程环境，持久化写入需要更高权限。",
        )

    def _update_path_registry_value(
        self,
        *,
        entry: str,
        prefer_machine: bool,
    ) -> WindowsEnvUpdateResult:
        import winreg

        for root, sub_key, scope in self._iter_registry_targets(prefer_machine=prefer_machine):
            try:
                with winreg.OpenKey(root, sub_key, 0, winreg.KEY_READ | winreg.KEY_SET_VALUE) as registry_key:
                    existing_value = self._read_registry_value(registry_key, "Path")
                    next_value = self._prepend_path_entries(existing_value, [entry])
                    if next_value != existing_value:
                        winreg.SetValueEx(registry_key, "Path", 0, winreg.REG_EXPAND_SZ, next_value)
                self._broadcast_environment_change()
                return WindowsEnvUpdateResult(
                    name="Path",
                    scope=scope,
                    applied=True,
                    message=f"已将 {entry} 写入{self._scope_label(scope)} PATH。",
                )
            except PermissionError:
                continue

        return WindowsEnvUpdateResult(
            name="Path",
            scope="process",
            applied=False,
            message=f"已将 {entry} 写入当前进程 PATH，持久化写入需要更高权限。",
        )

    def _iter_registry_targets(self, *, prefer_machine: bool):
        import winreg

        machine_target = (winreg.HKEY_LOCAL_MACHINE, self._MACHINE_ENV_KEY, "machine")
        user_target = (winreg.HKEY_CURRENT_USER, self._USER_ENV_KEY, "user")
        if prefer_machine:
            return (machine_target, user_target)
        return (user_target, machine_target)

    @staticmethod
    def _read_registry_value(registry_key: object, name: str) -> str:
        import winreg

        try:
            value, _ = winreg.QueryValueEx(registry_key, name)
        except FileNotFoundError:
            return ""
        return str(value or "")

    @staticmethod
    def _prepend_path_entries(current_value: str, entries: list[str]) -> str:
        parts = [item.strip() for item in current_value.split(";") if item.strip()]
        normalized = {item.casefold() for item in parts}
        next_parts = list(parts)
        for entry in reversed([item for item in entries if item]):
            if entry.casefold() in normalized:
                continue
            next_parts.insert(0, entry)
            normalized.add(entry.casefold())
        return ";".join(next_parts)

    @staticmethod
    def _scope_label(scope: str) -> str:
        return "系统级" if scope == "machine" else "用户级"

    @staticmethod
    def _broadcast_environment_change() -> None:
        if not sys.platform.startswith("win"):
            return
        hwnd_broadcast = 0xFFFF
        wm_settingchange = 0x001A
        smto_abortifhung = 0x0002
        result = ctypes.c_ulong()
        ctypes.windll.user32.SendMessageTimeoutW(
            hwnd_broadcast,
            wm_settingchange,
            0,
            "Environment",
            smto_abortifhung,
            5000,
            ctypes.byref(result),
        )
