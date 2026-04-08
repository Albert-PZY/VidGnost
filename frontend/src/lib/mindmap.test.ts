import { describe, expect, it } from 'vitest'

import { buildJsMindMindmap } from './mindmap'

describe('buildJsMindMindmap', () => {
  it('parses mermaid mindmap nodes and strips markdown control markers', () => {
    const mindmap = buildJsMindMindmap(
      [
        '```mindmap',
        'mindmap',
        '  root((网上的电脑优化教程，真的有用吗？))',
        '    # 网上电脑优化教程有效性分析',
        '    ## 核心结论',
        '    *   **受众局限**：普通用户风险高',
        '```',
      ].join('\n'),
    )

    expect(mindmap?.format).toBe('node_tree')
    expect(mindmap?.data.topic).toBe('网上的电脑优化教程，真的有用吗？')
    expect(mindmap?.data.children?.[0]?.topic).toBe('网上电脑优化教程有效性分析')
    expect(mindmap?.data.children?.[1]?.topic).toBe('核心结论')
    expect(mindmap?.data.children?.[2]?.topic).toBe('受众局限：普通用户风险高')
  })

  it('parses markdown heading trees into node_tree format', () => {
    const mindmap = buildJsMindMindmap(`# 主题

## 模块一
### 要点一
- 细节一
- 细节二`)

    expect(mindmap?.data.topic).toBe('主题')
    expect(mindmap?.data.children?.[0]?.topic).toBe('模块一')
    expect(mindmap?.data.children?.[0]?.children?.[0]?.topic).toBe('要点一')
    expect(mindmap?.data.children?.[0]?.children?.[0]?.children?.[0]?.topic).toBe('细节一')
  })

  it('returns null for flowchart mermaid diagrams', () => {
    const mindmap = buildJsMindMindmap(
      ['```mermaid', 'flowchart TD', '  A --> B', '```'].join('\n'),
    )

    expect(mindmap).toBeNull()
  })
})
