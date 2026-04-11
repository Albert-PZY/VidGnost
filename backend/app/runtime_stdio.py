from __future__ import annotations

import io
import os
import sys
from pathlib import Path


def _wrap_utf8_stream(stream: object) -> object:
    if not hasattr(stream, "buffer"):
        return stream

    encoding = getattr(stream, "encoding", None)
    errors = getattr(stream, "errors", None)
    if isinstance(encoding, str) and encoding.lower() == "utf-8" and errors == "replace":
        return stream

    return io.TextIOWrapper(stream.buffer, encoding="utf-8", errors="replace")


def enable_windows_utf8_stdio(*, skip_pytest_capture: bool = False) -> None:
    if sys.platform != "win32":
        return

    if skip_pytest_capture:
        entry_name = Path(sys.argv[0]).name.lower() if sys.argv else ""
        if "PYTEST_CURRENT_TEST" in os.environ or "pytest" in entry_name:
            return

    sys.stdout = _wrap_utf8_stream(sys.stdout)
    sys.stderr = _wrap_utf8_stream(sys.stderr)
