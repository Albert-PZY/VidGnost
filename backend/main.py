import uvicorn
from app.runtime_stdio import enable_windows_utf8_stdio


def main() -> None:
    enable_windows_utf8_stdio()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=["app"],
        reload_excludes=[".venv/*", "storage/*"],
    )


if __name__ == "__main__":
    main()
