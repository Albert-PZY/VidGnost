import type {
  ExportRecord,
  StudyHighlight,
  StudyPack,
  StudyPreview,
  StudyQuestion,
  StudyQuote,
  StudyState,
  StudyTheme,
  StudyWorkbenchResponse,
  SubtitleTrack,
  TranslationRecord,
} from "@vidgnost/contracts"

export type {
  ExportRecord,
  StudyHighlight,
  StudyPack,
  StudyPreview,
  StudyQuestion,
  StudyQuote,
  StudyState,
  StudyTheme,
  StudyWorkbenchResponse,
  SubtitleTrack,
  TranslationRecord,
}

export interface SubtitleTrackBundle {
  default_track_id: string | null
  tracks: SubtitleTrack[]
}

export interface StudyWorkspaceDraft {
  export_records: ExportRecord[]
  preview: StudyPreview
  study_pack: StudyPack
  study_state: StudyState
  subtitle_tracks: SubtitleTrack[]
  task: StudyWorkbenchResponse["task"]
  translation_records: TranslationRecord[]
}
