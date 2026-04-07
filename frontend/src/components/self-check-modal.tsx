import { LoaderCircle, RefreshCcw, Wrench } from 'lucide-react'
import type { TFunction } from 'i18next'

import { PreText } from './pretext'
import { ModalPanel, SelfCheckTimeline, TerminalPanel } from './workbench-panels'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { SelfCheckReport } from '../types'

interface SelfCheckModalProps {
  open: boolean
  onClose: () => void
  t: TFunction
  selfCheckBusy: boolean
  selfFixBusy: boolean
  selfCheckSessionId: string | null
  selfCheckReport: SelfCheckReport
  selfCheckError: string | null
  selfCheckLogs: string[]
  runSelfCheck: () => Promise<void>
  runSelfCheckAutoFix: () => Promise<void>
}

export function SelfCheckModal({
  open,
  onClose,
  t,
  selfCheckBusy,
  selfFixBusy,
  selfCheckSessionId,
  selfCheckReport,
  selfCheckError,
  selfCheckLogs,
  runSelfCheck,
  runSelfCheckAutoFix,
}: SelfCheckModalProps) {
  return (
    <ModalPanel
      open={open}
      title={t('selfCheck.modal.title')}
      description={t('selfCheck.modal.description')}
      onClose={onClose}
    >
      <div className="mb-[1.125rem] flex flex-wrap gap-2.5">
        <Button
          type="button"
          variant="secondary"
          onClick={() => void runSelfCheck()}
          disabled={selfCheckBusy || selfFixBusy}
        >
          {selfCheckBusy ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          {selfCheckBusy ? t('selfCheck.actions.running') : t('selfCheck.actions.run')}
        </Button>
        <Button
          type="button"
          onClick={() => void runSelfCheckAutoFix()}
          disabled={
            !selfCheckSessionId ||
            !selfCheckReport.auto_fix_available ||
            selfCheckBusy ||
            selfFixBusy
          }
        >
          {selfFixBusy ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Wrench className="mr-2 h-4 w-4" />
          )}
          {selfFixBusy ? t('selfCheck.actions.fixing') : t('selfCheck.actions.autoFix')}
        </Button>
      </div>
      <div className="grid gap-[1.125rem] lg:grid-cols-[1.2fr_1fr]">
        <section className="rounded-xl border border-border bg-surface-muted p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <PreText as="h3" variant="h3">
              {t('selfCheck.timeline.title')}
            </PreText>
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-1 text-xs text-accent">
              {t('selfCheck.progress', { value: selfCheckReport.progress })}
            </span>
          </div>
          <SelfCheckTimeline steps={selfCheckReport.steps} />
        </section>

        <section className="space-y-3.5">
          <div className="rounded-xl border border-border bg-surface-muted p-3.5">
            <PreText as="h3" variant="h3" className="mb-2">
              {t('selfCheck.issues.title')}
            </PreText>
            {selfCheckError && (
              <div className="mb-2 rounded-lg border border-red-400/45 bg-red-500/10 px-3 py-2 text-sm text-red-500">
                {selfCheckError}
              </div>
            )}
            {selfCheckReport.issues.length === 0 ? (
              <PreText variant="timestamp">{t('selfCheck.issues.none')}</PreText>
            ) : (
              <div className="max-h-[240px] space-y-2 overflow-auto pr-1">
                {selfCheckReport.issues.map((issue) => (
                  <div
                    key={issue.id}
                    className="rounded-lg border border-border bg-bg-base px-3 py-2"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <PreText variant="h3">{issue.title}</PreText>
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs',
                          issue.status === 'failed'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-amber-400/20 text-amber-500',
                        )}
                      >
                        {t(`selfCheck.stepStatus.${issue.status}`, { defaultValue: issue.status })}
                      </span>
                    </div>
                    <PreText variant="timestamp">{issue.message}</PreText>
                    {issue.manual_action && (
                      <PreText variant="timestamp" className="mt-1 text-text-main">
                        {t('selfCheck.manualAction')}: {issue.manual_action}
                      </PreText>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <PreText variant="timestamp" className="runtime-panel-caption">
              {t('selfCheck.logs.title')}
            </PreText>
            <TerminalPanel
              lines={selfCheckLogs}
              emptyText={t('selfCheck.logs.empty')}
              defaultVisibleLines={240}
              className="h-[200px]"
            />
          </div>
        </section>
      </div>
    </ModalPanel>
  )
}
