import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { QuickStartPanel, TerminalPanel } from './workbench-panels'

describe('TerminalPanel', () => {
  it('renders fallback text when no lines', () => {
    render(<TerminalPanel lines={[]} emptyText="暂无日志" />)
    expect(screen.getByText('暂无日志')).toBeInTheDocument()
  })

  it('renders joined log lines', () => {
    render(<TerminalPanel lines={['line-a', 'line-b']} emptyText="empty" />)
    expect(screen.getByText(/line-a/)).toBeInTheDocument()
    expect(screen.getByText(/line-b/)).toBeInTheDocument()
  })

  it('folds historical logs by default and can expand all', () => {
    const lines = Array.from({ length: 520 }, (_, index) => `line-${index + 1}`)
    const { container } = render(<TerminalPanel lines={lines} emptyText="empty" />)
    const getRuntimePre = () => container.querySelector('pre')

    expect(getRuntimePre()?.textContent?.startsWith('line-21')).toBe(true)
    expect(getRuntimePre()).toHaveTextContent('line-520')
    expect(screen.getByText(/已折叠\s*20|20.*log lines.*folded/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /展开全部|Show all/ }))
    expect(getRuntimePre()?.textContent?.startsWith('line-1')).toBe(true)
    expect(screen.getByText(/全部\s*520\s*条日志|showing all\s*520\s*log lines/i)).toBeInTheDocument()
  })
})

describe('QuickStartPanel', () => {
  it('builds toc buttons from markdown headings', () => {
    const markdown = `# 快速开始\n\n## 第一章 概览\n\n一些说明。\n\n### 子章节\n\n更多说明。`
    render(<QuickStartPanel markdown={markdown} />)
    expect(screen.getByRole('button', { name: '第一章 概览' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '子章节' })).toBeInTheDocument()
  })
})
