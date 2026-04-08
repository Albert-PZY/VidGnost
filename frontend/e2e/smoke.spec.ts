import { expect, test } from '@playwright/test'

test('首页工作台可加载', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('VidGnost')).toBeVisible()
  await expect(page.getByRole('button', { name: /开始分析|Start/i })).toBeVisible()
})
