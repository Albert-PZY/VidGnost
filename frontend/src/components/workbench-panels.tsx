import {
  memo,
  type PropsWithChildren,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  type LucideIcon,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import GithubSlugger from 'github-slugger'
import Select, { type SingleValue } from 'react-select'

import { MarkdownCodeBlock } from './markdown-code-block'
import { PreText } from './pretext'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { SelfCheckStep } from '../types'

const QUICKSTART_REMARK_PLUGINS = [remarkGfm]
const QUICKSTART_REHYPE_PLUGINS = [
  rehypeSlug,
  [rehypeHighlight, { detect: true, ignoreMissing: true }] as never,
]
const MARKDOWN_HEADING_PATTERN = /^(#{1,3})\s+(.+)$/

type UILocale = 'zh-CN' | 'en'
type QuickStartHeading = {
  id: string
  text: string
  level: 2 | 3
  children: QuickStartHeading[]
}

type QuickStartReadingStats = {
  characterCount: number
  latinWordCount: number
  estimatedMinutes: number
}

export type SelectFieldOption = {
  value: string
  label: string
}

export interface SidebarMenuButtonProps {
  icon: LucideIcon
  title: string
  description: string
  active?: boolean
  collapsed?: boolean
  onClick: () => void
}

export function SidebarMenuButton({
  icon: Icon,
  title,
  description,
  active = false,
  collapsed = false,
  onClick,
}: SidebarMenuButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? title : undefined}
      className={cn(
        'workbench-sidebar-action mb-2 w-full rounded-2xl border transition-all duration-200 last:mb-0',
        collapsed ? 'px-0 py-2.5' : 'px-3.5 py-3 text-left',
        active
          ? 'workbench-sidebar-action-active'
          : 'workbench-sidebar-action-idle hover:-translate-y-[1px]',
      )}
    >
      <div className={cn('flex items-center', collapsed ? 'justify-center' : 'mb-1.5 gap-2')}>
        <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-text-main' : 'text-accent')} />
        {!collapsed && (
          <PreText variant="h3" className="min-w-0 truncate">
            {title}
          </PreText>
        )}
      </div>
      {!collapsed && (
        <PreText variant="timestamp" className="line-clamp-2 break-words">
          {description}
        </PreText>
      )}
    </button>
  )
}

export interface ModalPanelProps extends PropsWithChildren {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  zIndexClassName?: string
  panelClassName?: string
  bodyClassName?: string
}

export function ModalPanel({
  open,
  title,
  description,
  onClose,
  children,
  zIndexClassName = 'z-40',
  panelClassName,
  bodyClassName,
}: ModalPanelProps) {
  const { t } = useTranslation()
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className={cn(
        'modal-panel-overlay modal-overlay-enter fixed inset-0 flex items-center justify-center px-4 py-6 backdrop-blur-[2px] md:px-6 md:py-8',
        zIndexClassName,
      )}
      onMouseDown={onClose}
    >
      <div
        className={cn(
          'modal-panel-surface modal-surface-enter w-full max-w-4xl overflow-hidden rounded-2xl border border-border/75 bg-surface-elevated shadow-[0_30px_70px_-34px_rgba(0,0,0,0.78)]',
          panelClassName,
        )}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-panel-header relative flex items-start justify-between gap-3 border-b border-border/60 px-5 py-4 md:px-7 md:py-[1.125rem]">
          <div className="min-w-0 flex-1 pr-12">
            <PreText as="h2" variant="h3">
              {title}
            </PreText>
            {description && (
              <PreText variant="timestamp" className="mt-0.5 leading-6">
                {description}
              </PreText>
            )}
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full md:right-4"
            onClick={onClose}
            aria-label={t('runtime.modal.close', { defaultValue: 'Close' })}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div
          className={cn(
            'modal-panel-body max-h-[80vh] overflow-auto bg-surface-elevated/70 px-5 py-[1.125rem] md:px-7 md:py-[1.375rem]',
            bodyClassName,
          )}
        >
          {children}
        </div>
      </div>
    </div>
  )
}

export interface SelectFieldProps {
  className?: string
  value: string
  options: SelectFieldOption[]
  onValueChange: (value: string) => void
  compact?: boolean
  isDisabled?: boolean
  leadingIcon?: ReactNode
  ariaLabel?: string
  menuPortalTarget?: HTMLElement | null
}

export function SelectField({
  className,
  value,
  options,
  onValueChange,
  compact = false,
  isDisabled = false,
  leadingIcon,
  ariaLabel,
  menuPortalTarget,
}: SelectFieldProps) {
  const selectedOption = options.find((option) => option.value === value) ?? null

  return (
    <div className={cn('relative', className)}>
      {leadingIcon && (
        <span className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-text-subtle">
          {leadingIcon}
        </span>
      )}
      <Select<SelectFieldOption, false>
        unstyled
        aria-label={ariaLabel}
        classNamePrefix="vg-select"
        className={cn(leadingIcon && 'vg-select-with-leading', compact && 'vg-select-compact')}
        options={options}
        value={selectedOption}
        isSearchable={false}
        isDisabled={isDisabled}
        menuPortalTarget={menuPortalTarget ?? undefined}
        menuPosition={menuPortalTarget ? 'fixed' : 'absolute'}
        styles={{
          menuPortal: (base) => ({
            ...base,
            zIndex: 80,
          }),
          control: (base) => ({
            ...base,
            fontSize: 13.5,
          }),
          menu: (base) => ({
            ...base,
            fontSize: 13.5,
          }),
          option: (base) => ({
            ...base,
            fontSize: 13.5,
            lineHeight: 1.4,
          }),
          singleValue: (base) => ({
            ...base,
            fontSize: 13.5,
          }),
          placeholder: (base) => ({
            ...base,
            fontSize: 13.5,
          }),
          input: (base) => ({
            ...base,
            fontSize: 13.5,
          }),
        }}
        classNames={{
          control: ({ isFocused }) =>
            cn(
              'w-full rounded-xl border border-border/85 bg-surface-elevated/92 text-text-main shadow-[inset_0_1px_0_var(--ui-inset-soft),0_10px_18px_-14px_rgba(15,23,42,0.55)] transition-all duration-200',
              compact ? 'min-h-[2.375rem]' : 'min-h-[2.875rem]',
              isFocused
                ? 'border-accent bg-bg-base shadow-[0_0_0_2px_rgba(31,142,241,0.24),0_12px_22px_-15px_rgba(15,23,42,0.72)]'
                : 'hover:-translate-y-[1px] hover:border-accent/50 hover:bg-bg-base hover:shadow-[0_14px_24px_-16px_rgba(15,23,42,0.62)]',
            ),
          valueContainer: () =>
            cn('gap-1', compact ? 'px-2.5 py-1.5' : 'px-3 py-2.5', leadingIcon && 'pl-8'),
          input: () => 'm-0 p-0 text-[0.84rem] text-text-main',
          singleValue: () => 'text-[0.84rem] font-medium tracking-[0.01em] text-text-main',
          placeholder: () => 'text-[0.84rem] text-text-subtle',
          indicatorsContainer: () => 'pr-2 text-text-subtle',
          dropdownIndicator: ({ isFocused }) =>
            cn('transition-colors', isFocused ? 'text-accent' : 'text-text-subtle'),
          menu: () =>
            'mt-2 overflow-hidden rounded-xl border border-border/80 bg-surface-elevated shadow-[0_20px_38px_-20px_rgba(15,23,42,0.75)]',
          menuList: () => 'max-h-72 overflow-auto p-1.5',
          option: ({ isFocused, isSelected }) =>
            cn(
              'cursor-pointer rounded-lg px-2.5 py-2 text-sm transition-colors',
              isSelected ? 'bg-accent/18 font-semibold text-accent' : 'text-text-main',
              !isSelected && isFocused && 'bg-surface-muted',
            ),
        }}
        components={{ IndicatorSeparator: null }}
        onChange={(nextValue: SingleValue<SelectFieldOption>) => {
          if (!nextValue) return
          onValueChange(nextValue.value)
        }}
      />
    </div>
  )
}

export interface ConfigFieldProps extends PropsWithChildren {
  label: string
  inputHint?: string
  explanation: string
}

export function ConfigField({ label, inputHint, explanation, children }: ConfigFieldProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <PreText as="span" variant="h3">
          {label}
        </PreText>
        {inputHint && (
          <span className="inline-flex rounded-md border border-border/70 bg-surface-muted px-1.5 py-0.5 text-[11px] text-text-subtle">
            {inputHint}
          </span>
        )}
        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-accent/15 text-accent">
          <CircleHelp className="h-3 w-3" />
        </span>
      </div>
      <PreText
        as="div"
        variant="timestamp"
        className="rounded-lg border border-border/65 bg-surface-muted/55 px-2.5 py-2 leading-relaxed"
      >
        <span className="font-semibold text-text-main/80">
          {t('whisper.meta.explanationLabel')}:{' '}
        </span>
        {explanation}
      </PreText>
      {children}
    </div>
  )
}

export interface TerminalPanelProps {
  lines: string[]
  emptyText: string
  defaultVisibleLines?: number
  className?: string
}

export function TerminalPanel({
  lines,
  emptyText,
  defaultVisibleLines = 500,
  className,
}: TerminalPanelProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const safeVisibleLines = Math.max(1, defaultVisibleLines)
  const hiddenLineCount = Math.max(0, lines.length - safeVisibleLines)

  const displayLines = useMemo(() => {
    if (!hiddenLineCount || expanded) return lines
    return lines.slice(-safeVisibleLines)
  }, [expanded, hiddenLineCount, lines, safeVisibleLines])
  const displayText = useMemo(
    () => (displayLines.length ? displayLines.join('\n') : emptyText),
    [displayLines, emptyText],
  )

  return (
    <div
      className={cn(
        'runtime-panel h-[420px] overflow-auto rounded-xl border p-3 text-[0.9rem] shadow-[inset_0_1px_0_var(--ui-inset-subtle)]',
        className,
      )}
    >
      {hiddenLineCount > 0 && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-surface-muted/55 px-2.5 py-1.5 text-xs text-text-subtle">
          <span>
            {expanded
              ? t('runtime.logPanel.expandedHint', { total: lines.length })
              : t('runtime.logPanel.foldedHint', { hidden: hiddenLineCount, total: lines.length })}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded
              ? t('runtime.logPanel.showRecent', { count: safeVisibleLines })
              : t('runtime.logPanel.showAll')}
          </Button>
        </div>
      )}
      <pre className="whitespace-pre-wrap font-mono text-[0.81rem] leading-[1.65]">
        {displayText}
      </pre>
    </div>
  )
}

export function SelfCheckTimeline({ steps }: { steps: SelfCheckStep[] }) {
  const { t } = useTranslation()

  if (steps.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-bg-base px-3 py-4 text-sm text-text-subtle">
        {t('selfCheck.timeline.waiting')}
      </div>
    )
  }

  return (
    <div className="relative pl-6">
      <div className="absolute left-[9px] top-1 h-[calc(100%-8px)] w-px bg-border" />
      <div className="space-y-3">
        {steps.map((step, index) => (
          <div key={step.id} className="relative">
            <span
              className={cn(
                'absolute -left-6 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full border-2 bg-bg-base',
                step.status === 'passed' && 'border-emerald-500 bg-emerald-500/10',
                step.status === 'warning' && 'border-amber-500 bg-amber-500/10',
                step.status === 'failed' && 'border-red-500 bg-red-500/10',
                step.status === 'running' && 'border-accent bg-accent/20',
                step.status === 'pending' && 'border-border bg-surface-muted',
              )}
            />
            <div className="rounded-lg border border-border bg-bg-base px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <PreText variant="h3" className="line-clamp-1">
                  {index + 1}. {step.title}
                </PreText>
                <span className="text-xs text-text-subtle">
                  {t(`selfCheck.stepStatus.${step.status}`, { defaultValue: step.status })}
                </span>
              </div>
              <PreText variant="timestamp">{step.message || '...'}</PreText>
              {step.manual_action && (
                <PreText variant="timestamp" className="mt-1 text-text-main">
                  {t('selfCheck.manualAction')}: {step.manual_action}
                </PreText>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const QuickStartMarkdownContent = memo(function QuickStartMarkdownContent({
  markdown,
}: {
  markdown: string
}) {
  return (
    <ReactMarkdown
      remarkPlugins={QUICKSTART_REMARK_PLUGINS}
      rehypePlugins={QUICKSTART_REHYPE_PLUGINS}
      components={{
        pre: ({ children, ...preProps }) => (
          <MarkdownCodeBlock {...preProps}>{children}</MarkdownCodeBlock>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
})

export function QuickStartPanel({ markdown }: { markdown: string }) {
  const { t, i18n } = useTranslation()
  const articleRef = useRef<HTMLElement | null>(null)
  const tocScrollAreaRef = useRef<HTMLDivElement | null>(null)
  const copyMarkdownTimerRef = useRef<number | null>(null)
  const [tocCollapsed, setTocCollapsed] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [activeHeadingId, setActiveHeadingId] = useState('')
  const [copiedMarkdown, setCopiedMarkdown] = useState(false)

  const currentLocale = normalizeLocale(i18n.resolvedLanguage ?? i18n.language ?? 'zh-CN')
  const outline = useMemo(() => parseQuickStartHeadings(markdown), [markdown])
  const readingStats = useMemo(() => buildQuickStartReadingStats(markdown), [markdown])

  const scrollToHeading = useCallback((id: string) => {
    const target = document.getElementById(id)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.history.replaceState(null, '', `#${id}`)
  }, [])

  const toggleGroup = useCallback((id: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const scheduleMarkdownCopyReset = useCallback(() => {
    if (copyMarkdownTimerRef.current !== null) {
      window.clearTimeout(copyMarkdownTimerRef.current)
    }
    copyMarkdownTimerRef.current = window.setTimeout(() => {
      setCopiedMarkdown(false)
      copyMarkdownTimerRef.current = null
    }, 1400)
  }, [])

  const copyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopiedMarkdown(true)
      scheduleMarkdownCopyReset()
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = markdown
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopiedMarkdown(true)
      scheduleMarkdownCopyReset()
    }
  }, [markdown, scheduleMarkdownCopyReset])

  useEffect(() => {
    const container = articleRef.current
    if (!container) return
    const headings = Array.from(container.querySelectorAll<HTMLElement>('h2[id], h3[id]'))
    if (headings.length === 0) return

    const updateActive = () => {
      let current = headings[0]?.id ?? ''
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 110) {
          current = heading.id
        } else {
          break
        }
      }
      setActiveHeadingId((prev) => (prev === current ? prev : current))
    }

    updateActive()
    let rafId = 0
    const onScroll = () => {
      if (rafId !== 0) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        updateActive()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [markdown])

  useEffect(() => {
    if (!activeHeadingId) return
    const parentGroupId = outline.find((group) =>
      group.children.some((child) => child.id === activeHeadingId),
    )?.id
    if (!parentGroupId) return
    const rafId = window.requestAnimationFrame(() => {
      setCollapsedGroups((prev) => {
        if (!(prev[parentGroupId] ?? false)) return prev
        return { ...prev, [parentGroupId]: false }
      })
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeHeadingId, outline])

  useEffect(() => {
    if (tocCollapsed || !activeHeadingId) return
    const container = tocScrollAreaRef.current
    if (!container) return

    const rafId = window.requestAnimationFrame(() => {
      const activeButton = container.querySelector<HTMLElement>(
        `[data-toc-id="${activeHeadingId}"]`,
      )
      if (!activeButton) return
      const containerRect = container.getBoundingClientRect()
      const targetRect = activeButton.getBoundingClientRect()
      const outOfTop = targetRect.top < containerRect.top + 8
      const outOfBottom = targetRect.bottom > containerRect.bottom - 8
      if (outOfTop || outOfBottom) {
        activeButton.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [activeHeadingId, tocCollapsed, collapsedGroups])

  useEffect(() => {
    return () => {
      if (copyMarkdownTimerRef.current !== null) {
        window.clearTimeout(copyMarkdownTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="w-full px-3 py-[1.125rem] md:px-4 md:py-5">
      <div
        className={cn(
          'grid gap-5',
          tocCollapsed
            ? 'grid-cols-[minmax(0,1fr)]'
            : 'md:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)]',
        )}
      >
        {!tocCollapsed && (
          <aside className="docs-toc-panel docs-surface-card self-start md:sticky md:top-[74px] md:flex md:h-[calc(100vh-88px)] md:flex-col">
            <div className="mb-2 flex items-center justify-between">
              <PreText as="h2" variant="h3">
                {t('quickStart.toc.title')}
              </PreText>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                aria-label={t('quickStart.toc.collapse')}
                onClick={() => setTocCollapsed(true)}
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
            <div
              ref={tocScrollAreaRef}
              className="quickstart-scroll-area min-h-0 flex-1 space-y-1 overflow-auto pr-1"
            >
              {outline.map((item) => (
                <QuickStartTocItem
                  key={item.id}
                  item={item}
                  activeHeadingId={activeHeadingId}
                  collapsedGroups={collapsedGroups}
                  onToggleGroup={toggleGroup}
                  onJump={scrollToHeading}
                />
              ))}
            </div>
          </aside>
        )}

        <section className="min-w-0">
          {tocCollapsed && (
            <div className="mb-2">
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-9 w-9 rounded-full"
                aria-label={t('quickStart.toc.expand')}
                onClick={() => setTocCollapsed(false)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="docs-content-card docs-surface-card">
            <div className="docs-content-toolbar">
              <div className="docs-reading-meta">
                <span className="docs-reading-meta-item">
                  <FileText className="h-3.5 w-3.5" />
                  {currentLocale === 'zh-CN'
                    ? t('quickStart.stats.characters', { count: readingStats.characterCount })
                    : t('quickStart.stats.words', {
                        count:
                          readingStats.latinWordCount ||
                          Math.max(1, Math.ceil(readingStats.characterCount / 5)),
                      })}
                </span>
                <span className="docs-reading-meta-item">
                  <Clock3 className="h-3.5 w-3.5" />
                  {t('quickStart.stats.readingTime', { minutes: readingStats.estimatedMinutes })}
                </span>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyMarkdown()}>
                {copiedMarkdown ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copiedMarkdown ? t('quickStart.copy.copied') : t('quickStart.copy.action')}
              </Button>
            </div>
            <article ref={articleRef} className="docs-markdown docs-content">
              <QuickStartMarkdownContent markdown={markdown} />
            </article>
          </div>
        </section>
      </div>
    </div>
  )
}

interface QuickStartTocItemProps {
  item: QuickStartHeading
  activeHeadingId: string
  collapsedGroups: Record<string, boolean>
  onToggleGroup: (id: string) => void
  onJump: (id: string) => void
}

function QuickStartTocItem({
  item,
  activeHeadingId,
  collapsedGroups,
  onToggleGroup,
  onJump,
}: QuickStartTocItemProps) {
  const { t } = useTranslation()
  const hasChildren = item.children.length > 0
  const groupCollapsed = collapsedGroups[item.id] ?? false
  const childActive = item.children.some((child) => child.id === activeHeadingId)
  const active = item.id === activeHeadingId || childActive

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleGroup(item.id)}
            className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-surface-muted hover:text-text-main"
            aria-label={groupCollapsed ? t('quickStart.toc.expand') : t('quickStart.toc.collapse')}
          >
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 transition-transform duration-300',
                !groupCollapsed && 'rotate-90',
              )}
            />
          </button>
        ) : (
          <span className="inline-block h-6 w-6" />
        )}
        <button
          type="button"
          onClick={() => onJump(item.id)}
          data-toc-id={item.id}
          className={cn(
            'w-full rounded-2xl px-3 py-1.5 text-left text-sm transition-all duration-300',
            active
              ? 'bg-accent/15 font-semibold text-accent shadow-[inset_0_0_0_1px_rgba(76,175,239,0.35)]'
              : 'text-text-subtle hover:bg-surface-muted hover:text-text-main',
          )}
        >
          {item.text}
        </button>
      </div>

      {hasChildren && !groupCollapsed && (
        <div className="ml-7 space-y-1">
          {item.children.map((child) => {
            const childIsActive = child.id === activeHeadingId
            return (
              <button
                key={child.id}
                type="button"
                onClick={() => onJump(child.id)}
                data-toc-id={child.id}
                className={cn(
                  'w-full rounded-2xl px-3 py-1.5 text-left text-[13px] transition-all duration-300',
                  childIsActive
                    ? 'bg-accent/15 font-semibold text-accent shadow-[inset_0_0_0_1px_rgba(76,175,239,0.35)]'
                    : 'text-text-subtle hover:bg-surface-muted hover:text-text-main',
                )}
              >
                {child.text}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function normalizeLocale(locale: string): UILocale {
  return locale?.toLowerCase().startsWith('en') ? 'en' : 'zh-CN'
}

function stripMarkdownInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/#+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseQuickStartHeadings(markdown: string): QuickStartHeading[] {
  const lines = markdown.split(/\r?\n/)
  const slugger = new GithubSlugger()
  const outline: QuickStartHeading[] = []
  let currentGroup: QuickStartHeading | null = null

  for (const line of lines) {
    const match = line.match(MARKDOWN_HEADING_PATTERN)
    if (!match) continue
    const level = match[1].length
    const headingText = stripMarkdownInline(match[2])
    if (!headingText) continue
    const id = slugger.slug(headingText)

    if (level === 1) continue
    if (level !== 2 && level !== 3) continue

    const node: QuickStartHeading = {
      id,
      text: headingText,
      level: level as 2 | 3,
      children: [],
    }

    if (node.level === 2) {
      outline.push(node)
      currentGroup = node
      continue
    }

    if (currentGroup) {
      currentGroup.children.push(node)
    } else {
      outline.push(node)
    }
  }

  return outline
}

function buildQuickStartReadingStats(markdown: string): QuickStartReadingStats {
  const plainText = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[>#*_~|]/g, ' ')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

  const characterCount = plainText.replace(/\s+/g, '').length
  const cjkCount = (plainText.match(/[\u3400-\u9fff]/g) ?? []).length
  const latinWordCount = (plainText.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? []).length
  const estimatedMinutes = Math.max(1, Math.ceil(cjkCount / 300 + latinWordCount / 200))

  return {
    characterCount,
    latinWordCount,
    estimatedMinutes,
  }
}
