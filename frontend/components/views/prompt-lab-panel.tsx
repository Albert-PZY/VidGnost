"use client"

import * as React from "react"
import { FlaskConical, Sparkles } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { PromptTemplateBundleResponse, PromptTemplateChannel } from "@/lib/types"

const CHANNEL_LABELS: Record<PromptTemplateChannel, string> = {
  correction: "文本纠错",
  notes: "笔记生成",
  mindmap: "思维导图",
  vqa: "问答检索",
}

function buildPromptPreview(templateText: string, title: string, transcript: string): string {
  const normalizedTemplate = templateText.trim()
  if (!normalizedTemplate) {
    return ""
  }

  return [
    normalizedTemplate,
    "",
    "## 样例输入",
    "",
    `标题：${title || "未命名任务"}`,
    "",
    transcript || "这里会显示样例转写内容。",
  ].join("\n")
}

interface PromptLabPanelProps {
  promptBundle: PromptTemplateBundleResponse | null
}

export function PromptLabPanel({ promptBundle }: PromptLabPanelProps) {
  const [channel, setChannel] = React.useState<PromptTemplateChannel>("notes")
  const [templateA, setTemplateA] = React.useState("")
  const [templateB, setTemplateB] = React.useState("")
  const [sampleTitle, setSampleTitle] = React.useState("产品回顾示例")
  const [sampleTranscript, setSampleTranscript] = React.useState(
    "00:12 本段介绍了核心目标。\n01:05 这里解释了具体执行步骤。\n02:18 最后总结风险与后续动作。",
  )

  const templates = React.useMemo(
    () => promptBundle?.templates.filter((item) => item.channel === channel) ?? [],
    [channel, promptBundle],
  )

  React.useEffect(() => {
    if (templates.length === 0) {
      setTemplateA("")
      setTemplateB("")
      return
    }
    setTemplateA((current) => current || templates[0].id)
    setTemplateB((current) => current || templates[Math.min(1, templates.length - 1)].id)
  }, [templates])

  const templateAItem = templates.find((item) => item.id === templateA) ?? null
  const templateBItem = templates.find((item) => item.id === templateB) ?? null

  return (
    <Card className="border-border/70 bg-card/70">
      <CardHeader className="border-b border-border/60">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Prompt Lab</CardTitle>
          <Badge variant="secondary">实验区</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          这里用于对比两个模板在同一段样例转写上的组织方式。左边看模板本体，右边看把样例标题和转写内容拼进去后的实际发送预览，不是模型输出结果。
        </p>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="grid gap-4 lg:grid-cols-[12rem_repeat(2,minmax(0,1fr))]">
          <div className="space-y-2">
            <Label>模板通道</Label>
            <Select value={channel} onValueChange={(value) => setChannel(value as PromptTemplateChannel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>模板 A</Label>
            <Select value={templateA} onValueChange={setTemplateA} disabled={templates.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="选择模板 A" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>模板 B</Label>
            <Select value={templateB} onValueChange={setTemplateB} disabled={templates.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="选择模板 B" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium">模板原文</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              原样展示当前模板内容，方便你检查结构、指令顺序和措辞。
            </p>
          </div>
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4">
            <p className="text-sm font-medium">样例提示草稿</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              把模板原文、样例标题和样例转写拼成一份调用前的提示词预览稿，用来判断真实发送给模型时会不会歧义。
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>样例标题</Label>
              <Input value={sampleTitle} onChange={(event) => setSampleTitle(event.target.value)} />
            </div>
            <div className="rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-2 font-medium text-foreground">
                <Sparkles className="h-4 w-4 text-primary" />
                观察建议
              </div>
              <ul className="mt-3 space-y-2 leading-6">
                <li>看模板是否把输出结构讲清楚。</li>
                <li>看样例输入注入后是否容易产生歧义。</li>
                <li>看两个模板谁更适合当前通道的目标结果。</li>
              </ul>
            </div>
          </div>
          <div className="space-y-2">
            <Label>样例转写内容</Label>
            <Textarea
              className="min-h-[11rem] font-mono text-sm"
              value={sampleTranscript}
              onChange={(event) => setSampleTranscript(event.target.value)}
            />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {[
            { label: "模板 A", template: templateAItem },
            { label: "模板 B", template: templateBItem },
          ].map((entry) => (
            <div key={entry.label} className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{entry.label}</span>
                {entry.template ? <Badge variant="outline">{entry.template.name}</Badge> : null}
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-card/70 p-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">模板原文</p>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">这里显示你当前保存的模板本体，不做额外加工。</p>
                  <pre className="mt-3 whitespace-pre-wrap text-sm leading-6">
                    {entry.template?.content || "当前通道还没有可比较的模板。"}
                  </pre>
                </div>
                <div className="rounded-xl border border-border/60 bg-card/70 p-3">
                  <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">样例提示草稿</p>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    这里是实际发给模型前的拼装预览，用来检查上下文是否顺畅，不代表模型最终回答。
                  </p>
                  <pre className="mt-3 whitespace-pre-wrap text-sm leading-6">
                    {entry.template
                      ? buildPromptPreview(entry.template.content, sampleTitle, sampleTranscript)
                      : "选择模板后将在这里生成样例提示草稿。"}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
