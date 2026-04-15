import bootstrapStepDefinitionsJson from "../../electron/bootstrap-steps.json"

export type DesktopBootstrapStepStatus = "pending" | "active" | "complete" | "error"

export interface DesktopBootstrapStepDefinition {
  id: string
  label: string
}

export const desktopBootstrapStepDefinitions =
  bootstrapStepDefinitionsJson as DesktopBootstrapStepDefinition[]

export function getDesktopBootstrapStepLabel(phaseId: string) {
  return (
    desktopBootstrapStepDefinitions.find((step) => step.id === phaseId)?.label ||
    desktopBootstrapStepDefinitions[0]?.label ||
    "初始化应用"
  )
}

export function buildDesktopBootstrapSteps(
  phaseId: string,
  phaseStatus: DesktopBootstrapStepStatus = "active",
): DesktopBootstrapStep[] {
  const phaseIndex = desktopBootstrapStepDefinitions.findIndex((step) => step.id === phaseId)
  const resolvedPhaseIndex = phaseIndex >= 0 ? phaseIndex : 0

  return desktopBootstrapStepDefinitions.map((step, index) => ({
    ...step,
    status:
      index < resolvedPhaseIndex
        ? "complete"
        : index === resolvedPhaseIndex
          ? phaseStatus
          : "pending",
  }))
}

export function getDesktopBootstrapProgress(steps: readonly Pick<DesktopBootstrapStep, "status">[]) {
  if (steps.length === 0) {
    return 0
  }

  const completedSteps = steps.filter((step) => step.status === "complete").length
  return Math.round((completedSteps / steps.length) * 100)
}

export function createDesktopBootstrapState({
  phaseId,
  phaseStatus = "active",
  title,
  message,
  detail,
  version,
}: {
  phaseId: string
  phaseStatus?: DesktopBootstrapStepStatus
  title: string
  message: string
  detail: string
  version?: string
}): DesktopBootstrapState {
  const steps = buildDesktopBootstrapSteps(phaseId, phaseStatus)

  return {
    phaseId,
    steps,
    progress: getDesktopBootstrapProgress(steps),
    title,
    message,
    detail,
    ...(version ? { version } : {}),
  }
}
