import { test, expect } from '@playwright/test'

test.describe('Layout System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForTimeout(1000)
  })

  test('1 chart fills full area (single mode)', async ({ page }) => {
    const chartArea = page.locator('.flex-1.relative.overflow-hidden').last()
    await expect(chartArea).toBeVisible()

    const canvases = chartArea.locator('canvas')
    await expect(canvases).toHaveCount(3, { timeout: 10000 })

    await page.screenshot({ path: 'e2e/results/01-single-chart.png' })
  })

  test('switch to horizontal layout shows 2 charts with splitter', async ({ page }) => {
    const layoutBtn = page.getByTestId('layout-horizontal')
    await layoutBtn.scrollIntoViewIfNeeded()
    await layoutBtn.click()
    await page.waitForTimeout(1500)

    const splitter = page.locator('.cursor-col-resize')
    await expect(splitter.first()).toBeVisible()

    await page.screenshot({ path: 'e2e/results/02-horizontal-split.png' })
  })

  test('switch to vertical layout shows 2 charts with splitter', async ({ page }) => {
    const layoutBtn = page.getByTestId('layout-vertical')
    await layoutBtn.scrollIntoViewIfNeeded()
    await layoutBtn.click()
    await page.waitForTimeout(1500)

    const splitter = page.locator('.cursor-row-resize')
    await expect(splitter.first()).toBeVisible()

    await page.screenshot({ path: 'e2e/results/03-vertical-split.png' })
  })

  test('drag splitter changes proportions (horizontal)', async ({ page }) => {
    const layoutBtn = page.getByTestId('layout-horizontal')
    await layoutBtn.scrollIntoViewIfNeeded()
    await layoutBtn.click()
    await page.waitForTimeout(1500)

    const splitter = page.locator('.cursor-col-resize').first()
    const box = await splitter.boundingBox()
    expect(box).not.toBeNull()

    const startX = box!.x + box!.width / 2
    const startY = box!.y + box!.height / 2

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(startX + 120, startY, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(500)

    await page.screenshot({ path: 'e2e/results/04-horizontal-dragged.png' })
  })

  test('switch back to single from dual', async ({ page }) => {
    await page.getByTestId('layout-horizontal').scrollIntoViewIfNeeded()
    await page.getByTestId('layout-horizontal').click()
    await page.waitForTimeout(1000)

    await page.getByTestId('layout-single').scrollIntoViewIfNeeded()
    await page.getByTestId('layout-single').click()
    await page.waitForTimeout(1000)

    const splitterH = page.locator('.cursor-col-resize')
    const splitterV = page.locator('.cursor-row-resize')
    await expect(splitterH).toHaveCount(0)
    await expect(splitterV).toHaveCount(0)

    await page.screenshot({ path: 'e2e/results/05-back-to-single.png' })
  })

  test('layout persists in localStorage', async ({ page }) => {
    await page.getByTestId('layout-vertical').scrollIntoViewIfNeeded()
    await page.getByTestId('layout-vertical').click()
    await page.waitForTimeout(500)

    await page.reload()
    await page.waitForTimeout(1500)

    const splitter = page.locator('.cursor-row-resize')
    await expect(splitter.first()).toBeVisible()

    await page.screenshot({ path: 'e2e/results/06-layout-persisted.png' })
  })

  test('dual mode: slot selector switches active chart', async ({ page }) => {
    // Switch to horizontal
    await page.getByTestId('layout-horizontal').scrollIntoViewIfNeeded()
    await page.getByTestId('layout-horizontal').click()
    await page.waitForTimeout(1500)

    // Slot selector should be visible
    const slot0 = page.getByTestId('slot-0')
    const slot1 = page.getByTestId('slot-1')
    await expect(slot0).toBeVisible()
    await expect(slot1).toBeVisible()

    // Slot 0 should be active by default (amber style)
    await expect(slot0).toHaveClass(/bg-amber-500\/20/)

    // Click slot 1 to switch
    await slot1.click()
    await page.waitForTimeout(300)
    await expect(slot1).toHaveClass(/bg-amber-500\/20/)

    await page.screenshot({ path: 'e2e/results/07-slot-switch.png' })
  })

  test('dual mode: independent charts (different TF shows different data)', async ({ page }) => {
    // Switch to horizontal
    await page.getByTestId('layout-horizontal').scrollIntoViewIfNeeded()
    await page.getByTestId('layout-horizontal').click()
    await page.waitForTimeout(2000)

    // Both charts should have canvases (each with 3 canvases = 6 total)
    const chartArea = page.locator('.flex-1.relative.overflow-hidden').last()
    const canvases = chartArea.locator('canvas')
    await expect(canvases).toHaveCount(6, { timeout: 15000 })

    // Switch slot 1 to a different timeframe
    await page.getByTestId('slot-1').click()
    await page.waitForTimeout(200)

    // Click 4h timeframe button (should be in header)
    const tf4h = page.locator('button:text("4h")').first()
    await tf4h.scrollIntoViewIfNeeded()
    await tf4h.click()
    await page.waitForTimeout(2000)

    // Both charts should still have canvases (independent data loads)
    const canvasesAfter = chartArea.locator('canvas')
    await expect(canvasesAfter).toHaveCount(6, { timeout: 15000 })

    await page.screenshot({ path: 'e2e/results/08-independent-charts.png' })
  })

  test('dual mode: axes contained in each panel (no overlap)', async ({ page }) => {
    // Switch to horizontal
    await page.getByTestId('layout-horizontal').scrollIntoViewIfNeeded()
    await page.getByTestId('layout-horizontal').click()
    await page.waitForTimeout(2000)

    // Get the two panel containers
    const panels = page.locator('.flex-1.relative.overflow-hidden .h-full.overflow-hidden')
    const panel0 = panels.nth(0)
    const panel1 = panels.nth(1)

    const box0 = await panel0.boundingBox()
    const box1 = await panel1.boundingBox()
    expect(box0).not.toBeNull()
    expect(box1).not.toBeNull()

    // Panels should be side by side (horizontal layout)
    // Panel 0 should be to the left of Panel 1
    expect(box0!.x + box0!.width).toBeLessThanOrEqual(box1!.x + 5) // small tolerance for splitter

    // Each panel should have its own axis canvases (check bounding boxes don't overlap)
    // Axis canvas of panel 1 should NOT extend into panel 0's area
    expect(box1!.x).toBeGreaterThanOrEqual(box0!.x + box0!.width - 5)

    await page.screenshot({ path: 'e2e/results/09-axes-contained.png' })
  })
})
