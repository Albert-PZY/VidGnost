"use client"

import * as React from "react"

import { createCachedModulePreloader } from "@/lib/module-preloader"

const loadDiagnosticsViewModule = () => import("@/components/views/diagnostics-view")
const loadHistoryViewModule = () => import("@/components/views/history-view")
const loadKnowledgeViewModule = () => import("@/components/views/knowledge-view")
const loadSettingsViewModule = () => import("@/components/views/settings-view")
const loadTaskProcessingViewModule = () => import("@/components/views/task-processing-view")

export const DiagnosticsView = React.lazy(async () => loadDiagnosticsViewModule().then((module) => ({
  default: module.DiagnosticsView,
})))

export const HistoryView = React.lazy(async () => loadHistoryViewModule().then((module) => ({
  default: module.HistoryView,
})))

export const KnowledgeLibraryView = React.lazy(async () => loadKnowledgeViewModule().then((module) => ({
  default: module.KnowledgeView,
})))

export const SettingsView = React.lazy(async () => loadSettingsViewModule().then((module) => ({
  default: module.SettingsView,
})))

export const TaskProcessingView = React.lazy(async () => loadTaskProcessingViewModule().then((module) => ({
  default: module.TaskProcessingView,
})))

export const preloadWorkbenchViewModules = createCachedModulePreloader([
  loadDiagnosticsViewModule,
  loadHistoryViewModule,
  loadKnowledgeViewModule,
  loadSettingsViewModule,
  loadTaskProcessingViewModule,
])
