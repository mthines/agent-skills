import { test as setup, expect } from '@playwright/test';
import path from 'node:path';

const STORAGE_STATE = path.resolve(__dirname, '../storageState.json');

setup('authenticate and persist storage state', async ({ page }) => {
  const email = process.env.E2E_USER_EMAIL;
  const password = process.env.E2E_USER_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'E2E_USER_EMAIL and E2E_USER_PASSWORD must be set for the seed run.',
    );
  }

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

  await page.context().storageState({ path: STORAGE_STATE });
});
