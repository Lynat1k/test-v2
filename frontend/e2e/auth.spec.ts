import { test, expect } from '@playwright/test'

const TEST_EMAIL = `test-${Date.now()}@example.com`
const TEST_PASSWORD = 'testpassword123'
const TEST_NICKNAME = 'TestUser'

test.describe('Auth flow', () => {
  test('register shows modal', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const loginBtn = page.locator('header button', { hasText: 'Войти' })
      .or(page.locator('header button', { hasText: 'Login' }))
    await expect(loginBtn).toBeVisible()
    await loginBtn.click()

    const switchToRegister = page.locator('button', { hasText: 'Регистрация' })
      .or(page.locator('button', { hasText: 'Sign Up' }))
      .or(page.locator('button', { hasText: 'Register' }))
    await expect(switchToRegister.first()).toBeVisible()
    await switchToRegister.first().click()

    const registerTitle = page.locator('h2', { hasText: 'Регистрация' })
      .or(page.locator('h2', { hasText: 'Sign Up' }))
    await expect(registerTitle).toBeVisible()
  })

  test('login shows modal', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const loginBtn = page.locator('header button', { hasText: 'Войти' })
      .or(page.locator('header button', { hasText: 'Login' }))
    await loginBtn.click()

    const loginTitle = page.locator('h2', { hasText: 'Вход' })
      .or(page.locator('h2', { hasText: 'Sign In' }))
    await expect(loginTitle).toBeVisible()

    const emailInput = page.locator('input[type="email"]')
    await expect(emailInput).toBeVisible()
  })

  test('login wrong credentials shows error', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const loginBtn = page.locator('header button', { hasText: 'Войти' })
      .or(page.locator('header button', { hasText: 'Login' }))
    await loginBtn.click()

    await page.locator('input[type="email"]').fill('wrong@example.com')
    await page.locator('input[type="password"]').fill('wrongpassword')
    await page.locator('button[type="submit"]').click()

    const error = page.locator('.bg-red-500\\/10')
    await expect(error).toBeVisible({ timeout: 10000 })
  })

  test('register and login flow', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Open register modal
    const loginBtn = page.locator('header button', { hasText: 'Войти' })
      .or(page.locator('header button', { hasText: 'Login' }))
    await loginBtn.click()

    const switchToRegister = page.locator('button', { hasText: 'Регистрация' })
      .or(page.locator('button', { hasText: 'Sign Up' }))
      .or(page.locator('button', { hasText: 'Register' }))
    await switchToRegister.first().click()

    // Fill registration form
    await page.locator('input[placeholder*="имя" i], input[placeholder*="username" i], input[placeholder*="пользовател" i]').first().fill(TEST_NICKNAME)
    await page.locator('input[type="email"]').fill(TEST_EMAIL)
    const passwordInputs = page.locator('input[type="password"]')
    await passwordInputs.nth(0).fill(TEST_PASSWORD)
    await passwordInputs.nth(1).fill(TEST_PASSWORD)

    await page.locator('button[type="submit"]').click()

    // Should show verify email screen or close
    await expect(page.locator('text=Проверьте почту').or(page.locator('text=Check your email'))).toBeVisible({ timeout: 10000 })

    // Close modal
    const closeBtn = page.locator('button', { hasText: 'Закрыть' }).or(page.locator('button', { hasText: 'Close' }))
    await closeBtn.first().click()
  })

  test('escape closes modal', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const loginBtn = page.locator('header button', { hasText: 'Войти' })
      .or(page.locator('header button', { hasText: 'Login' }))
    await loginBtn.click()

    const loginTitle = page.locator('h2', { hasText: 'Вход' })
      .or(page.locator('h2', { hasText: 'Sign In' }))
    await expect(loginTitle).toBeVisible()

    await page.keyboard.press('Escape')

    await expect(loginTitle).toBeHidden({ timeout: 5000 })
  })
})
