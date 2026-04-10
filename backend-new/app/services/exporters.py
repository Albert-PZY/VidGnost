from __future__ import annotations


def render_markmap_html(markdown_text: str, title: str) -> str:
    safe_title = title.replace("<", "&lt;").replace(">", "&gt;")
    escaped_markdown = markdown_text.replace("</script>", "<\\/script>")
    return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{safe_title} - Mindmap</title>
    <style>
      html, body {{
        margin: 0;
        width: 100%;
        height: 100%;
        background: #ffffff;
        color: #111827;
      }}
      #mindmap {{
        width: 100%;
        height: 100%;
      }}
    </style>
  </head>
  <body>
    <svg id="mindmap"></svg>
    <script type="module">
      import {{ Transformer }} from "https://cdn.jsdelivr.net/npm/markmap-lib@0.18.12/+esm";
      import {{ Markmap }} from "https://cdn.jsdelivr.net/npm/markmap-view@0.18.12/+esm";
      const markdown = `{escaped_markdown}`;
      const transformer = new Transformer();
      const {{ root }} = transformer.transform(markdown);
      Markmap.create("#mindmap", {{ autoFit: true, duration: 300 }}, root);
    </script>
  </body>
</html>
"""
