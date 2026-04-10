import React from "react"
import ReactDOM from "react-dom/client"
import "@uiw/react-md-editor/markdown-editor.css"
import "@uiw/react-markdown-preview/markdown.css"

import App from "./App"
import "@/app/globals.css"

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
)
