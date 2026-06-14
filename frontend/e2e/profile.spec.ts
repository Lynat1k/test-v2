import { test, expect } from '@playwright/test'

const TEST_EMAIL = `profile-${Date.now()}@example.com`
const TEST_PASSWORD = 'testpassword123'
const TEST_NICKNAME = 'ProfileTestUser'

test.describe('Profile flow', () => {
  test.beforeEach(async ({ page }) => {
    // Register and login a test user
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Register
    const loginBtn = page.locator('header button', { hasText: 'Войти' })
      .or(page.locator('header button', { hasText: 'Login' }))
    await loginBtn.click()

    const switchToRegister = page.locator('button', { hasText: 'Регистрация' })
      .or(page.locator('button', { hasText: 'Sign Up' }))
      .or(page.locator('button', { hasText: 'Register' }))
    await switchToRegister.first().click()

    await page.locator('input[placeholder*="имя" i], input[placeholder*="username" i], input[placeholder*="пользовател" i]').first().fill(TEST_NICKNAME)
    await page.locator('input[type="email"]').fill(TEST_EMAIL)
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill(TEST_PASSWORD)
    await passwordInputs.nth(1).fill(TEST_PASSWORD)

    await page.locator('button[type="submit"]').click()

    // Close verify email modal
    const closeBtn = page.locator('button', { hasText: 'Закрыть' }).or(page.locator('button', { hasText: 'Close' }))
    await closeBtn.first().click({ timeout: 5000 }).catch(() => {})
  })

  test('profile opens from header', async ({ page }) => {
    // Click on nickname in header to open profile
    const profileBtn = page.locator('header button', { hasText: TEST_NICKNAME })
    await expect(profileBtn).toBeVisible({ timeout: 10000 })
    await profileBtn.click()

    // Profile view should be visible
    const profileTitle = page.locator('text=Персональные данные').or(page.locator('text=Personal Details'))
    await expect(profileTitle).toBeVisible({ timeout: 5000 })

    // Back to terminal button should be visible
    const backBtn = page.locator('button', { hasText: 'Вернуться в терминал' })
      .or(page.locator('button', { hasText: 'Back to Terminal' }))
    await expect(backBtn).toBeVisible()
  })

  test('update nickname', async ({ page }) => {
    // Open profile
    const profileBtn = page.locator('header button', { hasText: TEST_NICKNAME })
    await expect(profileBtn).toBeVisible({ timeout: 10000 })
    await profileBtn.click()

    // Wait for profile to load
    await page.locator('text=Персональные данные').or(page.locator('text=Personal Details')).waitFor({ timeout: 5000 })

    // Change nickname
    const nicknameInput = page.locator('input[type="text"]').first()
    await nicknameInput.clear()
    await nicknameInput.fill('NewProfileNick')

    // Save
    const saveBtn = page.locator('button[type="submit"]').first()
    await saveBtn.click()

    // Should show success notification
    const success = page.locator('text=Изменения сохранены').or(page.locator('text=Profile saved'))
    await expect(success).toBeVisible({ timeout: 5000 })
  })

  test('change password shows confirmation', async ({ page }) => {
    // Open profile
    const profileBtn = page.locator('header button', { hasText: TEST_NICKNAME })
    await expect(profileBtn).toBeVisible({ timeout: 10000 })
    await profileBtn.click()

    // Wait for profile to load
    await page.locator('text=Персональные данные').or(page.locator('text=Personal Details')).waitFor({ timeout: 5000 })

    // Fill change password form
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill(TEST_PASSWORD)
    await passwordInputs.nth(1).fill('newpassword456')
    await passwordInputs.nth(2).fill('newpassword456')

    // Submit
    const changePwBtn = page.locator('button[type="submit"]').nth(1)
    await changePwBtn.click()

    // Should show success or trigger reload
    const successOrReload = page.locator('text=Пароль изменён').or(page.locator('text=Password changed'))
    await expect(successOrReload).toBeVisible({ timeout: 5000 })
  })

  test('profile shows subscription info', async ({ page }) => {
    // Open profile
    const profileBtn = page.locator('header button', { hasText: TEST_NICKNAME })
    await expect(profileBtn).toBeVisible({ timeout: 10000 })
    await profileBtn.click()

    // Wait for profile to load
    await page.locator('text=Персональные данные').or(page.locator('text=Personal Details')).waitFor({ timeout: 5000 })

    // Should show subscription section
    const subInfo = page.locator('text=Данные подписки').or(page.locator('text=Subscription Details'))
    await expect(subInfo).toBeVisible()

    // Should show Free tier
    const freeTier = page.locator('text=Free')
    await expect(freeTier.first()).toBeVisible()
  })

  test('back to terminal', async ({ page }) => {
    // Open profile
    const profileBtn = page.locator('header button', { hasText: TEST_NICKNAME })
    await expect(profileBtn).toBeVisible({ timeout: 10000 })
    await profileBtn.click()

    // Wait for profile
    await page.locator('text=Персональные данные').or(page.locator('text=Personal Details')).waitFor({ timeout: 5000 })

    // Click back
    const backBtn = page.locator('button', { hasText: 'Вернуться в терминал' })
      .or(page.locator('button', { hasText: 'Back to Terminal' }))
    await backBtn.click()

    // Terminal should be visible (chart header)
    const chartHeader = page.locator('[data-testid="chart-header"]').or(page.locator('text=BTCUSDT'))
    await expect(chartHeader.first()).toBeVisible({ timeout: 5000 })
  })
})
