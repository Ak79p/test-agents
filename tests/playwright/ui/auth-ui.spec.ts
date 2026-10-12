import { test, expect } from '../fixtures';
import { env } from '../config/env';

test('AUTH-UI-001 Parent logs in and lands on their dashboard', { tag: ['@ui', '@auth'] }, async ({ page, loginPage, dashboardPage, appNav }) => {
  await test.step('S1 Open /login', async () => {
    await loginPage.goto();
  });

  await test.step('S2 Fill email-input and password-input with TEST_USER_* and click login-button', async () => {
    const { release } = await loginPage.loginHoldingRequest(env.testUser.email, env.testUser.password);
    await expect(loginPage.submitButton).toHaveText('Signing in…');
    await expect(loginPage.submitButton).toBeDisabled();
    await release();
  });

  await test.step('S3 Wait for dashboard-page', async () => {
    await expect(dashboardPage.root).toBeVisible();
    await expect(appNav.dashboardLink).toBeVisible();
    await expect(page).toHaveURL(new URL('/', env.baseUrl).href);
    await expect(dashboardPage.pageTitle).toHaveText('Hello, Thandi');
    await expect(appNav.userName).toHaveText('Thandi Mokoena');
    await expect(appNav.dashboardLink).toHaveAttribute('aria-current', 'page');
    const session = JSON.parse((await loginPage.storedSession()) ?? 'null');
    expect(typeof session?.token).toBe('string');
    expect(session.token.length).toBeGreaterThan(0);
    expect(typeof session.expiresAt).toBe('string');
    expect(session.expiresAt).not.toBe('');
    expect(session.parent?.id).toBe('par_001');
  });
});

test('AUTH-UI-002 Login form shows client validation and server errors', { tag: ['@ui', '@auth'] }, async ({ page, loginPage }) => {
  const loginRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/auth/login')) 
      loginRequests.push(request.url());
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
    expect(await loginPage.storedSession()).toBeNull();
  });
});

test('AUTH-UI-003 Protected routes redirect to login and return after authentication; logout ends the session', { tag: ['@ui', '@auth'] }, async ({ page, loginPage, appNav, transactionsPage, api }) => {
  let token: string | undefined;

  await test.step('S1 With no session, open /transactions', async () => {
    await page.goto('/transactions');
    await expect(page).toHaveURL(/\/login\?next=%2Ftransactions$/);
  });

  await test.step('S2 Log in on the redirected page', async () => {
    await loginPage.login(env.testUser.email, env.testUser.password);
    await expect(page).toHaveURL(/\/transactions$/);
    await expect(transactionsPage.root).toBeVisible();
    token = await loginPage.sessionToken();
  });

  await test.step('S3 Click logout-button', async () => {
    await appNav.logout();
    await expect(page).toHaveURL(/\/login$/);
    expect(await loginPage.storedSession()).toBeNull();
  });

  await test.step('S4 Open / again', async () => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login\?next=%2F$/);
    const meResponse = await api.get('auth/me', { headers: { Authorization: `Bearer ${token}` } });
    expect(meResponse.status()).toBe(401);
  });
});

test('AUTH-UI-004 Expired or revoked session sends the user to login with a message', { tag: ['@ui', '@auth'] }, async ({ page, loginPage, dashboardPage, api }) => {
  await test.step('S1 Log in and open the dashboard', async () => {
    await loginPage.goto();
    await loginPage.login(env.testUser.email, env.testUser.password);
    await expect(dashboardPage.root).toBeVisible();
  });

  await test.step('S2 Revoke the token out-of-band', async () => {
    const token = await loginPage.sessionToken();
    await api.post('auth/logout', { headers: { Authorization: `Bearer ${token}` } });
  });

  await test.step('S3 Reload the dashboard', async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/login(\?.*)?$/);
    await expect(loginPage.sessionExpired).toHaveText('Your session has expired. Please log in again.');
    expect(await loginPage.storedSession()).toBeNull();
  });
});
