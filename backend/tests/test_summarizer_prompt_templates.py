from app.services.prompt_template_store import MINDMAP_PROMPT_TEMPLATES, SUMMARY_PROMPT_TEMPLATES
from app.services.prompt_constants import MINDMAP_PROMPT, SUMMARY_PROMPT


def test_summary_prompt_templates_include_default_and_presets() -> None:
    assert SUMMARY_PROMPT_TEMPLATES["default"] == SUMMARY_PROMPT
    assert set(SUMMARY_PROMPT_TEMPLATES.keys()) == {"default", "course", "interview"}


def test_mindmap_prompt_templates_include_default_and_presets() -> None:
    assert MINDMAP_PROMPT_TEMPLATES["default"] == MINDMAP_PROMPT
    assert set(MINDMAP_PROMPT_TEMPLATES.keys()) == {"default", "course", "interview"}
