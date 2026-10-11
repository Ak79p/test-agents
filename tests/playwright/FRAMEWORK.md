# FeeFlow Playwright framework guide

The conventions the code actually follows. Read this before automating a case, then check the files it names. **If this guide and the code disagree, the code is the current behaviour:** follow it and fix this guide in the same change. Don't invent a new pattern silently.

## 1. Structure

```
tests/playwright/
├── playwright.config.ts   projects, reporters, timeouts, optional webServer
├── config/env.ts          the only reader of environment variables (env.*)
├── fixtures/index.ts      custom test + expect (loginPage, api, apiAs); import tests from here
├── pages/                 page objects: locators and actions only (login-page.ts)
├── ui/<area>-ui.spec.ts   UI cases, one file per area      → ui-chromium (ui-mobile for @mobile)
├── api/<area>-api.spec.ts API cases, one file per area     → api
└── hybrid/                reserved for a catalogue Hybrid layer (none today) → hybrid
```

Projects: `api` (baseURL `API_BASE_URL`), `ui-chromium` (desktop, excludes `@mobile`), `ui-mobile` (Pixel 7, only `@mobile`), `hybrid`. One worker (shared SQLite), expect/action timeouts 10 s, test timeout 60 s, retries 0 locally and 2 in CI.

## 2. Placement and tags (from the ID, never by judgment)

`node test-manager/scripts/case.mjs placement <ID>` prints the file, project, tags and run command, from `placementFor()` in `test-manager/lib/catalogue.mjs`. The catalogue validator rejects any other `scriptPath`.

| ID | File | Tags |
|---|---|---|
| `AUTH-UI-003` | `ui/auth-ui.spec.ts` | `@ui @auth` |
| `PAY-API-003` | `api/pay-api.spec.ts` | `@api @payments` |
| `FEE-PERF-001` | `../k6/scripts/FEE-PERF-001.js` | k6 `options.tags` |

* Grep for the ID first. If it exists, edit it in place; never duplicate it. Otherwise append to the file and keep the existing tests unchanged.
* A UI case that also checks an API response or localStorage stays in `ui/` and uses the `api` fixture.
* The title is `'<ID> <catalogue title>'`, with native tags: `test(title, { tag: ['@ui', '@auth'] }, …)`. Use one `test.step('S<n> …')` per catalogue step.

## 3. Fixtures

Import `test` and `expect` from `fixtures` (`import { test, expect } from '../fixtures'`), not from `@playwright/test`. The custom fixtures extend the built-ins, so `page`, `context`, `request`, `browser` and `playwright` are all still available.

| Fixture | What it gives you | Use when |
|---|---|---|
| `page`, `context` (built-in) | an isolated browser context per test | every UI test |
| `request` (built-in) | API context with the project baseURL | API tests (`api` project) |
| `loginPage` | `LoginPage` bound to `page` (not navigated) | any test that fills the login form |
| `api` | unauthenticated `APIRequestContext` at `env.apiBaseUrl`, disposed after the test | out-of-band API calls from a UI test (verify or revoke a token, set up data) |
| `apiAs` | factory `apiAs(user) => Promise<APIRequestContext>`: logs in via `POST auth/login` and returns a context at `env.apiBaseUrl` with `Authorization: Bearer <token>`. Every context it creates is disposed after the test. On a non-200 login it throws `Login as <email> failed: HTTP <status>` | API calls that need an authenticated parent (`apiAs(env.loadtestUser)`); call it again for a second user. Not for cases where login itself is under test (log in inline there) |

There is deliberately **no authenticated-page fixture** yet: only one test (AUTH-UI-004) logs in purely as setup. Add one once two or more tests need a logged-in start. Make it worker-safe: log in via the UI or API per test, or use `storageState`, and remember that `dev/reset` revokes every token.

Adding a fixture: put it in `fixtures/index.ts` with a JSDoc line, `async ({ deps }, use) => { const x = await create(); try { await use(x); } finally { await x.dispose(); } }` (as the `api` fixture does). Dispose everything it creates in `finally`, so cleanup runs even when the test fails. Add one only when two or more tests reuse it. No shared mutable state between tests.

## 4. Page objects and helpers

* A page object (`pages/<name>-page.ts`) exposes `readonly` locators and multi-step actions (`goto()`, `login()`). **No assertions in page objects.** Acceptance criteria stay visible in the test.
* Create one only when two or more tests drive the same page. Single-use interactions stay inline in the spec.
* API clients and workflow helpers (e.g. "create a payment and poll until SUCCEEDED"): none exist yet. Add one only when a second test needs the same multi-call workflow, as a plain function or class taking an `APIRequestContext`, exposed through a fixture if it needs setup or disposal.
* No base classes, factories or singletons.

### Abstraction rule

Before adding a fixture, page object, API client, or helper, inspect existing implementations and determine whether they already solve the problem.

Reuse existing abstractions when appropriate. Introduce a new abstraction only when it reduces duplication, manages a resource lifecycle, or makes test intent clearer.

Keep case-specific steps and acceptance assertions visible in the test. Do not add inheritance, factories, singletons, or additional layers solely to follow a design pattern.

## 5. Locators and assertions

* Locators: `getByTestId` (stable `data-testid`s, see `docs/APPLICATION.md` §13 or grep `frontend/src`), then `getByRole`, then `getByLabel`. CSS or XPath only if nothing else exists.
* Use web-first assertions (`await expect(locator).toHaveText(…)`, `await expect(page).toHaveURL(…)`) with the spec's exact values. Never loosen, merge or drop an expected result. Don't add assertions the spec doesn't ask for; a `waitForResponse` used as a sync point is fine.
* For "no request sent", collect URLs with one `page.on('request')` listener and assert `expect(urls).toEqual([])`.
* For async outcomes use `expect.poll` or `expect(...).toPass()` with an explicit timeout. Never `waitForTimeout`.
* Read localStorage with `page.evaluate(() => localStorage.getItem('feeflow.session'))`. The session JSON has `.token`.
* Money is shown in `en-ZA` with non-breaking spaces (`R 24 200,00`), so normalise whitespace before comparing.

## 6. Authentication, data and isolation

* UI login: `loginPage.login(env.testUser.email, env.testUser.password)`. The token is in `localStorage['feeflow.session'].token`. API login: `const payer = await apiAs(env.loadtestUser)` gives an authenticated context; use `request.post('auth/login', { data: { email, password } })` inline only when login itself is under test. `apiAs` logs in on demand, so a case that needs `dev/reset` calls the reset first and `apiAs` afterwards.
* Every test gets a fresh browser context, so no session leaks between tests. Don't rely on another test's state or on ordering.
* `POST dev/reset` re-seeds and **revokes every token**: call it before logging in, and only when the case's preconditions require it. `PUT dev/simulation` changes must be restored (`DELETE dev/simulation`) in `afterEach`/`afterAll`.
* Writing tests (payments) should use a `loadtestNNN@example.com` account or reset first. Generate idempotency keys with `crypto.randomUUID()`.

## 7. Environment and secrets

* Use `import { env } from '../config/env'` for `env.baseUrl`, `env.apiBaseUrl` (trailing `/`), `env.testUser`, `env.secondaryUser` and `env.loadtestUser` (loadtest050 by default via `LOADTEST_USER_EMAIL`; its password is `LOADTEST_USER_PASSWORD`, falling back to `TEST_USER_PASSWORD` because all seeded accounts share it). Credentials are read lazily from `tests/playwright/.env` (copy `.env.example`), and a missing value throws a clear error.
* API paths are relative with no leading slash: `api.get('auth/me')`. A leading `/` drops `/api/v1`.
* Never hard-code passwords, tokens or base URLs, and never log them.

## 8. Commands, debugging, artifacts

Run from `tests/playwright/`:

| Goal | Command |
|---|---|
| One case (the placement command) | `npx playwright test ui/auth-ui.spec.ts --project=ui-chromium --grep AUTH-UI-004 --reporter=list` |
| Category | `npm run test:ui` · `npm run test:api` · `npm run test:hybrid` |
| By tag | `npx playwright test --grep "@auth"` |
| Typecheck (after changing `config/`, `fixtures/`, `pages/` or the config) | `npm run typecheck` |
| Debug | add `--headed` or `--debug`; `npm run pw:ui` |
| Report / trace | `npm run report`; `npx playwright show-trace test-results/<test>/trace.zip` |

On failure, the trace, screenshot and video are kept in `test-results/<test>/`. The HTML report is in `playwright-report/`.

## 9. Examples

**UI** (`ui/auth-ui.spec.ts`):
```ts
import { test, expect } from '../fixtures';
import { env } from '../config/env';

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
  // S3 …
});
```

**API, login under test** (`api/<area>-api.spec.ts`, project `api`):
```ts
import { test, expect } from '../fixtures';
import { env } from '../config/env';

test('AUTH-API-001 <catalogue title>', { tag: ['@api', '@auth'] }, async ({ request }) => {
  await test.step('S1 Log in with valid credentials', async () => {
    const res = await request.post('auth/login', { data: { email: env.testUser.email, password: env.testUser.password } });
    expect(res.status()).toBe(200);
  });
});
```

**API, authenticated** (`api/pay-api.spec.ts`, PAY-API-001):
```ts
test('PAY-API-001 <catalogue title>', { tag: ['@api', '@payments'] }, async ({ request, apiAs }) => {
  let payer: APIRequestContext;
  await test.step('S1 Log in as loadtest050 and GET fees/outstanding', async () => {
    payer = await apiAs(env.loadtestUser);
    const res = await payer.get('fees/outstanding');
    expect(res.status()).toBe(200);
  });
  // S2 … payer.post('payments', { headers: { 'Idempotency-Key': randomUUID() }, data: { … } })
});
```

**Hybrid:** none. There is no catalogue Hybrid layer. UI cases with API checks use the UI example above.
