import {
  isValidElement,
  memo,
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { MermaidViewer } from './mermaid-viewer'
import { cn } from '../lib/utils'

type MarkdownCodeBlockProps = ComponentProps<'pre'>

function MarkdownCodeBlockImpl({ children, className, ...preProps }: MarkdownCodeBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  const code = useMemo(() => extractText(children).replace(/\n$/, ''), [children])
  const language = useMemo(() => extractCodeLanguage(children), [children])
  const isMermaid = language === 'mermaid'

  const scheduleCopyReset = useCallback(() => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current)
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copyTimerRef.current = null
    }, 1200)
  }, [])

  const copyCode = useCallback(async () => {
    if (!code.trim()) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      scheduleCopyReset()
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = code
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
      setCopied(true)
      scheduleCopyReset()
    }
  }, [code, scheduleCopyReset])

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="docs-code-wrap">
      <button type="button" className="docs-code-copy-btn" onClick={() => void copyCode()}>
        {copied ? t('quickStart.copy.copied') : t('quickStart.copy.code')}
      </button>
      {isMermaid ? (
        <MermaidViewer code={code} />
      ) : (
        <pre {...preProps} className={cn('docs-pre', className)}>
          {children}
        </pre>
      )}
    </div>
  )
}

export const MarkdownCodeBlock = memo(MarkdownCodeBlockImpl, areMarkdownCodeBlockPropsEqual)

function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node)
  }
  if (Array.isArray(node)) {
    return node.map((item) => extractText(item)).join('')
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractText(node.props.children)
  }
  return ''
}

function extractCodeLanguage(node: ReactNode): string {
  if (Array.isArray(node)) {
    for (const item of node) {
      const next = extractCodeLanguage(item)
      if (next) return next
    }
    return ''
  }
  if (isValidElement<{ className?: string; children?: ReactNode }>(node)) {
    const className = String(node.props.className ?? '')
    const matched = className.match(/language-([a-z0-9_-]+)/i)
    if (matched?.[1]) {
      return matched[1].toLowerCase()
    }
    return extractCodeLanguage(node.props.children)
  }
  return ''
}

function areMarkdownCodeBlockPropsEqual(
  prevProps: Readonly<MarkdownCodeBlockProps>,
  nextProps: Readonly<MarkdownCodeBlockProps>,
): boolean {
  if (prevProps.className !== nextProps.className) return false
  return extractText(prevProps.children) === extractText(nextProps.children)
}
