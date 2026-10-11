import { test, expect } from '../fixtures';
import { env } from '../config/env';

test('AUTH-UI-001: Parent logs in and lands on their dashboard', { tag: ['@ui', '@auth'] }, async ({ page, loginPage }) => {
  await loginPage.goto();
  await loginPage.login(env.testUser.email, env.testUser.password);
  await expect(page.getByTestId('nav-dashboard')).toBeVisible();
});

test('AUTH-UI-002 Login form shows client validation and server errors', { tag: ['@ui', '@auth'] }, async ({ page, loginPage }) => {
  const loginRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/auth/login')) loginRequests.push(request.url());
  });

  await test.step('S1 Open /login and submit with empty fields', async () => {
    await loginPage.goto();
    await loginPage.submitButton.click();
    await expect(loginPage.emailError).toHaveText('Email is required.');
    await expect(loginPage.passwordError).toHaveText('Password is required.');
    expect(loginRequests).toEqual([]);
  });

  await test.step('S2 Submit malformed email with any password', async () => {
    await loginPage.login('not-an-email', 'any-password');
    await expect(loginPage.emailError).toHaveText('Enter a valid email address.');
    expect(loginRequests).toEqual([]);
  });

  await test.step('S3 Submit TEST_USER_EMAIL with wrong password', async () => {
    const loginResponse = page.waitForResponse((response) => response.url().includes('/auth/login'));
    await loginPage.login(env.testUser.email, 'wrong-password');
    await loginResponse;
    await expect(loginPage.formError).toContainText('Invalid email or password.');
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('feeflow.session'))).toBeNull();
  });
});

test('AUTH-UI-003 Protected routes redirect to login and return after authentication; logout ends the session', { tag: ['@ui', '@auth'] }, async ({ page, loginPage, api }) => {
  let token = '';

  await test.step('S1 With no session, open /transactions', async () => {
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);
  });

  await test.step('S2 Log in on the redirected page', async () => {
    await loginPage.login(env.testUser.email, env.testUser.password);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByTestId('transactions-page')).toBeVisible();
    token = await page.evaluate(() => JSON.parse(localStorage.getItem('feeflow.session') ?? '{}').token);
  });

  await test.step('S3 Click logout-button', async () => {
    await page.getByTestId('logout-button').click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.evaluate(() => localStorage.getItem('feeflow.session'))).toBeNull();
  });

  await test.step('S4 Open / again', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
    const meResponse = await api.get('auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(meResponse.status()).toBe(401);
  });
});

test('AUTH-UI-004 Expired or revoked session sends the user to login with a message', { tag: ['@ui', '@auth'] }, async ({ page, loginPage, api }) => {
  await test.step('S1 Log in and open the dashboard', async () => {
    await loginPage.goto();
    await loginPage.login(env.testUser.email, env.testUser.password);
    await expect(page.getByTestId('dashboard-page')).toBeVisible();
  });

  await test.step('S2 Revoke the token out-of-band', async () => {
    const token = await page.evaluate(() => JSON.parse(localStorage.getItem('feeflow.session') ?? '{}').token);
    await api.post('auth/logout', { headers: { Authorization: `Bearer ${token}` } });
  });

  await test.step('S3 Reload the dashboard', async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
    await expect(loginPage.sessionExpired).toHaveText('Your session has expired. Please log in again.');
    expect(await page.evaluate(() => localStorage.getItem('feeflow.session'))).toBeNull();
  });
});
