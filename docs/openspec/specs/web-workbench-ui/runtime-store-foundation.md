# Task Processing Runtime Store Foundation

## Scope

This baseline addendum documents the task processing runtime state foundation in the frontend workbench.

Implementation files:

- `frontend/stores/task-processing-runtime-types.ts`
- `frontend/stores/task-processing-runtime-store.ts`
- `frontend/lib/task-processing-runtime-helpers.ts`

## Runtime State Domains

The runtime store model defines migration-ready slices for:

- `task`
- `taskEvents`
- `liveTranscript`
- `correctionPreview` and persisted correction artifacts
- `chatHistory`
- `traceCache`

## Contracted Exports

Core exports:

- `createTaskProcessingRuntimeStore`
- `taskProcessingRuntimeStore`
- `useTaskProcessingRuntimeStore`
- `getTaskProcessingRuntimeState`
- `resetTaskProcessingRuntimeStore`
- `selectLiveTranscriptSegments`
- `selectMergedTranscriptSegments`
- `selectEffectiveCorrectionMode`

## Behavioral Notes

- Task events follow bounded retention.
- Transcript updates use incremental merge helpers.
- Correction preview stream updates use pure reduction logic.
- Chat and trace state updates are explicitly action-driven for phased migration.

