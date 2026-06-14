import { test, expect } from '@playwright/test'

test.describe('Settings persistence', () => {
  test('guest settings persist in localStorage', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Change timeframe via header controls (click a different TF button)
    const tf5m = page.locator('button', { hasText: '5m' }).first()
    if (await tf5m.isVisible()) {
      await tf5m.click()
    }

    // Check localStorage has chart controls
    const stored = await page.evaluate(() => {
      return localStorage.getItem('procluster_chart_controls')
    })
    expect(stored).toBeTruthy()
  })

  test('page loads without auth (guest mode)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Header should show login button
    const loginBtn = page.locator('header button', { hasText: 'Войти' })
      .or(page.locator('header button', { hasText: 'Login' }))
    await expect(loginBtn).toBeVisible()
  })

  test('chart renders in guest mode', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Wait for chart canvas to appear
    const canvas = page.locator('canvas').first()
    await expect(canvas).toBeVisible({ timeout: 15000 })
  })
})
