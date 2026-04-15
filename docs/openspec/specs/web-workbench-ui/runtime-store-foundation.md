# Task Processing Runtime Store Foundation

## Scope

This baseline addendum documents the task processing runtime state foundation in the frontend workbench.

Implementation files:

- `apps/desktop/src/stores/task-processing-runtime-types.ts`
- `apps/desktop/src/stores/task-processing-runtime-store.ts`
- `apps/desktop/src/lib/task-processing-runtime-helpers.ts`

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
- `traceCache` uses bounded retention and trims older entries during persistence or runtime updates so per-task VQA trace snapshots do not grow without limit.
- Bounded trace retention preserves the actively viewed or selected trace entry when pruning older cached items.

