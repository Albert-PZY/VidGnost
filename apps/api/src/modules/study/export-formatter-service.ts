import type {
  ExportRecordFormat,
  KnowledgeNote,
  StudyPack,
  SubtitleTrack,
  TranslationRecord,
} from "@vidgnost/contracts"

interface FormattedExport {
  content: string
  format: ExportRecordFormat
}

export class ExportFormatterService {
  formatStudyPack(studyPack: StudyPack): FormattedExport {
    return {
      content: [
        `# ${studyPack.overview}`,
        "",
        "## Highlights",
        ...studyPack.highlights.map((item) => `- [${formatRange(item.start_seconds, item.end_seconds)}] ${item.summary}`),
        "",
        "## Themes",
        ...studyPack.themes.map((item) => `- ${item.title}: ${item.summary}`),
        "",
        "## Questions",
        ...studyPack.questions.map((item) => `- ${item.question}`),
        "",
        "## Quotes",
        ...studyPack.quotes.map((item) => `- ${item.quote}`),
      ].join("\n"),
      format: "md",
    }
  }

  formatSubtitleTracks(tracks: SubtitleTrack[]): FormattedExport {
    return {
      content: JSON.stringify(tracks, null, 2),
      format: "json",
    }
  }

  formatTranslationRecords(records: TranslationRecord[]): FormattedExport {
    return {
      content: JSON.stringify(records, null, 2),
      format: "json",
    }
  }

  formatKnowledgeNotes(notes: KnowledgeNote[]): FormattedExport {
    return {
      content: notes.length === 0
        ? "# Knowledge Notes\n"
        : [
            "# Knowledge Notes",
            ...notes.flatMap((note) => [
              "",
              `## ${note.title}`,
              `- 标签: ${note.tags.join(", ") || "未设置"}`,
              `- 来源: ${note.source_kind}`,
              "",
              note.excerpt,
              "",
              note.note_markdown || "",
            ]),
          ].join("\n"),
      format: "md",
    }
  }
}

function formatRange(startSeconds: number, endSeconds: number): string {
  return `${formatTime(startSeconds)}-${formatTime(endSeconds)}`
}

function formatTime(value: number): string {
  const safeValue = Math.max(0, Math.floor(Number(value) || 0))
  const minutes = Math.floor(safeValue / 60)
  const seconds = safeValue % 60
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
}
