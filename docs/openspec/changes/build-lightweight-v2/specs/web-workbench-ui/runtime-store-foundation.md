# Task Processing Runtime Store Foundation

## Scope

This addendum documents the runtime-state foundation added for the task processing workbench in the frontend.

Implementation files:

- `frontend/stores/task-processing-runtime-types.ts`
- `frontend/stores/task-processing-runtime-store.ts`
- `frontend/lib/task-processing-runtime-helpers.ts`

## Runtime State Domains

The store foundation covers the following domain slices for incremental migration:

- `task`
- `taskEvents`
- `liveTranscript`
- `correctionPreview` and persisted correction artifacts
- `chatHistory`
- `traceCache`

## Contracted Exports

Main exports intended for integration:

- `createTaskProcessingRuntimeStore`
- `taskProcessingRuntimeStore`
- `useTaskProcessingRuntimeStore`
- `getTaskProcessingRuntimeState`
- `resetTaskProcessingRuntimeStore`
- `selectLiveTranscriptSegments`
- `selectMergedTranscriptSegments`
- `selectEffectiveCorrectionMode`

## Behavioral Notes

- Task events are appended using a bounded list strategy.
- Transcript deltas are merged via key-based incremental indexing.
- Correction preview stream events are reduced through a deterministic pure reducer.
- Chat and trace slices expose minimal mutation actions for staged migration from component-local state.

