import { decorateMarkdownContent } from "@/lib/markdown-decoration"

interface MarkdownDecorateWorkerRequest {
  requestId: string
  markdown: string
  taskId?: string
}

interface MarkdownDecorateWorkerResponse {
  requestId: string
  rendered: string
}

self.onmessage = (event: MessageEvent<MarkdownDecorateWorkerRequest>) => {
  const { requestId, markdown, taskId } = event.data
  const rendered = decorateMarkdownContent(markdown, taskId)
  const payload: MarkdownDecorateWorkerResponse = {
    requestId,
    rendered,
  }
  self.postMessage(payload)
}
