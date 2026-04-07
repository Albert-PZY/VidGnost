import { expect, test } from '@playwright/test'

test('首页工作台可加载', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('VidGnost')).toBeVisible()
  await expect(page.getByRole('button', { name: /开始分析|Start/i })).toBeVisible()
})

test('运行配置弹窗每次打开都会重新读取最新本地运行配置', async ({ page }) => {
  const llmResponses = [
    {
      mode: 'api',
      load_profile: 'balanced',
      api_key: 'test-key-old',
      base_url: 'https://example.com/v1',
      model: 'qwen-first',
      correction_mode: 'strict',
      correction_batch_size: 24,
      correction_overlap: 3,
    },
    {
      mode: 'api',
      load_profile: 'balanced',
      api_key: 'test-key-old',
      base_url: 'https://example.com/v1',
      model: 'qwen-first',
      correction_mode: 'strict',
      correction_batch_size: 24,
      correction_overlap: 3,
    },
    {
      mode: 'api',
      load_profile: 'memory_first',
      api_key: 'test-key-new',
      base_url: 'https://example.com/v2',
      model: 'qwen-second',
      correction_mode: 'rewrite',
      correction_batch_size: 18,
      correction_overlap: 2,
    },
    {
      mode: 'api',
      load_profile: 'balanced',
      api_key: 'test-key-latest',
      base_url: 'https://example.com/v3',
      model: 'qwen-third',
      correction_mode: 'off',
      correction_batch_size: 12,
      correction_overlap: 1,
    },
  ]
  const whisperResponses = [
    {
      model_default: 'small',
      language: 'zh',
      device: 'cpu',
      compute_type: 'int8',
      model_load_profile: 'balanced',
      beam_size: 1,
      vad_filter: true,
      chunk_seconds: 180,
      target_sample_rate: 16000,
      target_channels: 1,
    },
    {
      model_default: 'small',
      language: 'zh',
      device: 'cpu',
      compute_type: 'int8',
      model_load_profile: 'balanced',
      beam_size: 1,
      vad_filter: true,
      chunk_seconds: 180,
      target_sample_rate: 16000,
      target_channels: 1,
    },
    {
      model_default: 'small',
      language: 'en',
      device: 'cpu',
      compute_type: 'float32',
      model_load_profile: 'memory_first',
      beam_size: 2,
      vad_filter: false,
      chunk_seconds: 240,
      target_sample_rate: 16000,
      target_channels: 1,
    },
    {
      model_default: 'small',
      language: 'ja',
      device: 'cpu',
      compute_type: 'int8',
      model_load_profile: 'balanced',
      beam_size: 3,
      vad_filter: true,
      chunk_seconds: 300,
      target_sample_rate: 16000,
      target_channels: 1,
    },
  ]
  let llmGetCount = 0
  let whisperGetCount = 0

  await page.route('**/api/config/llm', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const payload = llmResponses[Math.min(llmGetCount, llmResponses.length - 1)]
    llmGetCount += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })

  await page.route('**/api/config/whisper', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    const payload = whisperResponses[Math.min(whisperGetCount, whisperResponses.length - 1)]
    whisperGetCount += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    })
  })

  await page.route('**/api/config/prompts', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary_templates: [],
        notes_templates: [],
        mindmap_templates: [],
        selected_summary_template_id: '',
        selected_notes_template_id: '',
        selected_mindmap_template_id: '',
      }),
    })
  })

  await page.goto('/')

  await page.getByRole('button', { name: /运行配置|Runtime Config/i }).click()
  await expect(
    page.getByRole('dialog', { name: /运行配置中心|Runtime Config Center/i }),
  ).toBeVisible()
  await expect(page.getByPlaceholder(/模型名|Model Name/i)).toHaveValue('qwen-second')
  await page.getByRole('tab', { name: /Faster-Whisper/i }).click()
  await expect(page.getByPlaceholder(/切分秒数|Chunk Seconds/i)).toHaveValue('240')
  await page.getByRole('button', { name: /关闭窗口|Close Window|Close/i }).click()

  await page.getByRole('button', { name: /运行配置|Runtime Config/i }).click()
  await expect(
    page.getByRole('dialog', { name: /运行配置中心|Runtime Config Center/i }),
  ).toBeVisible()
  await expect(page.getByPlaceholder(/模型名|Model Name/i)).toHaveValue('qwen-third')
  await page.getByRole('tab', { name: /Faster-Whisper/i }).click()
  await expect(page.getByPlaceholder(/切分秒数|Chunk Seconds/i)).toHaveValue('300')
})

test('运行配置中心 notes 模板可新建并激活且不影响 summary/mindmap 选中态', async ({ page }) => {
  const state = {
    bundle: {
      summary_templates: [
        {
          id: 'summary-default',
          channel: 'summary',
          name: 'Summary Default',
          content: 'summary default content',
          is_default: true,
          created_at: '2026-04-07T00:00:00Z',
          updated_at: '2026-04-07T00:00:00Z',
        },
      ],
      notes_templates: [
        {
          id: 'notes-default',
          channel: 'notes',
          name: 'Notes Default',
          content: 'notes default content',
          is_default: true,
          created_at: '2026-04-07T00:00:00Z',
          updated_at: '2026-04-07T00:00:00Z',
        },
      ],
      mindmap_templates: [
        {
          id: 'mindmap-default',
          channel: 'mindmap',
          name: 'Mindmap Default',
          content: 'mindmap default content',
          is_default: true,
          created_at: '2026-04-07T00:00:00Z',
          updated_at: '2026-04-07T00:00:00Z',
        },
      ],
      selected_summary_template_id: 'summary-default',
      selected_notes_template_id: 'notes-default',
      selected_mindmap_template_id: 'mindmap-default',
    },
    nextNotesTemplateCounter: 1,
  }

  await page.route('**/api/config/llm', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        mode: 'api',
        load_profile: 'balanced',
        api_key: 'test-key',
        base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: 'qwen3.5-omni-flash',
        correction_mode: 'strict',
        correction_batch_size: 24,
        correction_overlap: 3,
      }),
    })
  })

  await page.route('**/api/config/whisper', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        model_default: 'small',
        language: 'zh',
        device: 'cpu',
        compute_type: 'int8',
        model_load_profile: 'balanced',
        beam_size: 1,
        vad_filter: true,
        chunk_seconds: 120,
        target_sample_rate: 16000,
        target_channels: 1,
      }),
    })
  })

  await page.route('**/api/config/prompts', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.bundle),
    })
  })

  await page.route('**/api/config/prompts/templates', async (route) => {
    const request = route.request()
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }
    const payload = request.postDataJSON() as {
      channel: 'summary' | 'notes' | 'mindmap'
      name: string
      content: string
    }
    const now = '2026-04-07T00:00:00Z'

    if (payload.channel === 'notes') {
      const newId = `notes-custom-${state.nextNotesTemplateCounter}`
      state.nextNotesTemplateCounter += 1
      state.bundle.notes_templates.push({
        id: newId,
        channel: 'notes',
        name: payload.name,
        content: payload.content,
        is_default: false,
        created_at: now,
        updated_at: now,
      })
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.bundle),
    })
  })

  await page.route('**/api/config/prompts/selection', async (route) => {
    const request = route.request()
    if (request.method() !== 'PUT') {
      await route.fallback()
      return
    }
    const payload = request.postDataJSON() as {
      selected_summary_template_id: string
      selected_notes_template_id: string
      selected_mindmap_template_id: string
    }
    state.bundle.selected_summary_template_id = payload.selected_summary_template_id
    state.bundle.selected_notes_template_id = payload.selected_notes_template_id
    state.bundle.selected_mindmap_template_id = payload.selected_mindmap_template_id

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(state.bundle),
    })
  })

  await page.goto('/')

  await page.getByRole('button', { name: /运行配置|Runtime Config/i }).click()
  await expect(
    page.getByRole('dialog', { name: /运行配置中心|Runtime Config Center/i }),
  ).toBeVisible()

  await page.getByRole('tab', { name: /提示词模板|Prompt Templates/i }).click()
  await page.getByRole('tab', { name: /详细笔记模板管理|Detailed Notes Template Manager/i }).click()

  const summarySelectedBefore = state.bundle.selected_summary_template_id
  const mindmapSelectedBefore = state.bundle.selected_mindmap_template_id

  await page.getByRole('button', { name: /新建模板|New Template/i }).click()

  const notesTemplateName = `Notes E2E ${Date.now()}`
  await page.getByRole('textbox').first().fill(notesTemplateName)
  await page.locator('.w-md-editor-text-input').fill('# Notes E2E\n\n- point 1\n- point 2')

  await page.getByRole('button', { name: /保存模板|Save Template/i }).click()

  const createdTemplateCard = page.locator('div[role="button"]', { hasText: notesTemplateName })
  await expect(createdTemplateCard).toBeVisible()
  await expect(createdTemplateCard.getByText(/当前生效|Active/i)).toBeVisible()

  await page.getByRole('tab', { name: /摘要模板管理|Summary Template Manager/i }).click()
  const summaryCard = page.locator('div[role="button"]', { hasText: 'Summary Default' })
  await expect(summaryCard.getByText(/当前生效|Active/i)).toBeVisible()

  await page.getByRole('tab', { name: /思维导图模板管理|Mindmap Template Manager/i }).click()
  const mindmapCard = page.locator('div[role="button"]', { hasText: 'Mindmap Default' })
  await expect(mindmapCard.getByText(/当前生效|Active/i)).toBeVisible()

  expect(state.bundle.selected_summary_template_id).toBe(summarySelectedBefore)
  expect(state.bundle.selected_mindmap_template_id).toBe(mindmapSelectedBefore)
  expect(state.bundle.selected_notes_template_id).not.toBe('notes-default')
})
