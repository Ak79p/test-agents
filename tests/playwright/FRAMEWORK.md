# FeeFlow Playwright framework guide

The conventions the code actually follows. Read this before automating a case, then check the files it names. **If this guide and the code disagree, the code is the current behaviour:** follow it and fix this guide in the same change. Don't invent a new pattern silently.

## 1. Structure

```
tests/playwright/
├── playwright.config.ts      projects, reporters, timeouts, optional webServer
├── config/env.ts             the only reader of environment variables (env.*)
├── fixtures/index.ts         custom test + expect and every fixture (§3); import tests from here
├── pages/                    page objects: locators, accessors and actions, no assertions (§4)
│   └── components/           reusable UI components shared by several screens (app-nav.ts)
├── api-clients/              thin API clients returning raw APIResponse (§5)
├── test-data/                shared test data (cards.ts: the simulated gateway cards)
├── scripts/check-locators.mjs  enforces locator-free spec files (§6)
├── ui/<area>-ui.spec.ts      UI cases, one file per area      → ui-chromium (ui-mobile for @mobile)
├── api/<area>-api.spec.ts    API cases, one file per area     → api
└── hybrid/                   reserved for a catalogue Hybrid layer (none today) → hybrid
```

Projects: `api` (baseURL `API_BASE_URL`), `ui-chromium` (desktop, excludes `@mobile`), `ui-mobile` (Pixel 7, only `@mobile`), `hybrid`. One worker (shared SQLite), expect/action timeouts 10 s, test timeout 60 s, retries 0 locally and 2 in CI.

## 2. Test-file standards (mandatory)

Every automated test:

1. Uses the exact catalogue ID and title: `test('<ID> <catalogue title>', …)`.
2. Lives in the file from `node test-manager/scripts/case.mjs placement <ID>` and carries its tags with Playwright's native option: `test(title, { tag: ['@ui', '@auth'] }, …)`. Grep for the ID first: an existing test is edited in place, never duplicated; new tests are appended and existing ones stay unchanged.
3. Preserves every acceptance criterion with the spec's exact values: never drop, merge, loosen or reword one, and don't add assertions the spec doesn't ask for.
4. **Is locator-free:** no `page.getByTestId/getByRole/getByLabel/getByText/locator(…)`, no `.nth/.first/.last/.filter/.and/.or` on a locator, no `$`/`$$`/`waitForSelector`. Use the page objects, components and fixtures instead. If an assertion needs an element no page object exposes, add a named accessor to the right page object or component. `npm run check:locators` enforces this (§6).
5. Has one `test.step('S<n> …')` per catalogue step (plus an optional `Precondition: …` step).
6. Keeps acceptance assertions visible in the test body: `await expect(dashboardPage.outstandingTotal).toHaveText('R 24 200,00')`. Page objects and clients never assert.
7. Uses web-first assertions (`toHaveText`, `toHaveAttribute`, `toBeVisible`, `toHaveURL`, `toHaveCount`); `expect.poll`/`toPass()` with an explicit timeout for async outcomes. An observation window (proving something does not happen over time) is derived from the app's documented interval, expressed as a wait for the unwanted event that must time out, and named in the test; never an arbitrary sleep. Such cases, and waits longer than the 10 s default, go through thorough mode.
8. Has no fixed sleeps, arbitrary retries or timeout inflation, no hard-coded credentials or base URLs, and no single-use helpers.
9. Follows the reset, simulation, data and shared-database rules in §7.
10. Never changes application code to make a test pass unless the user explicitly authorised it.

Allowed in tests (they are not locators): `expect(page).toHaveURL(…)`, `page.goto(…)`, `page.reload()`, a `page.on('request')` listener for "no request sent" checks, `page.waitForResponse(…)` as a one-off sync point, and non-UI assertions on API responses (status, headers, JSON) using the clients or `api`.

## 3. Fixtures

Import `test` and `expect` from `fixtures` (`import { test, expect } from '../fixtures'`), not from `@playwright/test`. The custom fixtures extend the built-ins, so `page`, `context`, `request`, `browser` and `playwright` are all still available.

| Fixture | What it gives you | Use when |
|---|---|---|
| `page`, `context` (built-in) | an isolated browser context per test | every UI test (for `goto`, `reload`, URL checks) |
| `request` (built-in) | API context with the project baseURL, unauthenticated | API tests where login itself is under test |
| `loginPage` | `LoginPage` (`/login`) | logging in, login-form cases, reading the stored session |
| `dashboardPage` | `DashboardPage` (`/`) | stats, student cards, the outstanding fees table, paying a fee |
| `checkoutPage` | `CheckoutPage` (`/fees/:feeId/pay`) | amount step, card step, paying |
| `feeDetailPage` | `FeeDetailPage` (`/fees/:feeId`) | fee status, amount paid and balance after a payment |
| `paymentPage` | `PaymentPage` (`/payments/:paymentId`, result and details) | payment status, details, timeline, back to dashboard |
| `transactionsPage` | `TransactionsPage` (`/transactions`) | history rows and opening a payment |
| `appNav` | `AppNav` component (signed-in header) | nav links, logout |
| `api` | unauthenticated `APIRequestContext` at `env.apiBaseUrl`, disposed after the test | out-of-band API calls from a UI test (verify or revoke a token) |
| `apiAs` | factory `apiAs(user) => Promise<APIRequestContext>`: logs in via `POST auth/login` and returns a Bearer-authenticated context. Every context it creates is disposed after the test, pass or fail. Throws `Login as <email> failed: HTTP <status>` on a non-200 login | API calls as a parent; wrap it in a client (`new PaymentsApi(await apiAs(env.loadtestUser))`). Call it again for a second user |
| `dev` | `reset()` (`POST dev/reset`), `setSimulation(changes)` (`PUT dev/simulation`, partial; returns the new settings), `restoreSimulation()` (`DELETE dev/simulation`; returns the backend's `.env` defaults). Each throws on a non-200 | preconditions "freshly seeded" → `dev.reset()`; "at .env defaults" → `dev.restoreSimulation()`; "PUT dev/simulation {…}" → `dev.setSimulation({…})` |
| `appHealth` (automatic, worker-scoped) | once per worker it GETs `${API_BASE_URL}health`, plus the project's `baseURL` for browser projects, and fails with the startup command (`scripts\start-backend.ps1` / `scripts\start-frontend.ps1`) if one is down | always on; an `api`-only run doesn't need the frontend |

Page-object fixtures are bound to the test's `page` and not navigated: log in (lands on the dashboard), then drive the app through actions.

**`dev` rules.**
* Call `dev.reset()` explicitly as the first line of the step that logs in, so the precondition stays visible in the test. It re-seeds the database, revokes every token and also restores simulation defaults, so log in (`loginPage.loginAs`, `apiAs`) only after it. Never call it mid-test.
* `dev.reset()` refuses to run when the run has more than one worker (`PW_WORKERS`/`--workers` > 1): a reset would revoke the other workers' sessions in the shared SQLite DB.
* Simulation changes are restored in the fixture's teardown (`DELETE dev/simulation` in `finally`) whenever `setSimulation` was called and not followed by `restoreSimulation()`, even when the test fails. A failed restore fails the test. You don't need an `afterEach`.
* Simulation defaults come from the backend (`backend/.env` via `DELETE dev/simulation`); never hard-code them. The current values are `gateway_latency_ms` 800, `gateway_timeout_ms` 5000 and `pending_resolution_seconds` 8.
* The `dev/reset` response contains the demo password, so the fixture reads only its status. Don't log it.

There is deliberately **no authenticated-page fixture**: most cases that need a logged-in start must call `dev.reset()` *before* logging in, and a fixture runs before the test body, so it would either hide the reset or log in too early (the reset would then revoke its session). Injecting the session into `localStorage` would couple tests to the frontend's internal session shape. Log in with one line instead:

```ts
await test.step('S1 Log in as Thandi', async () => {
  await dev.reset();                 // only if the case says "freshly seeded"
  await loginPage.loginAs(env.testUser);
});
```

Adding a fixture: put it in `fixtures/index.ts` with a JSDoc line, `async ({ deps }, use) => { const x = await create(); try { await use(x); } finally { await x.dispose(); } }` (as the `api` fixture does). Dispose everything it creates in `finally`. No shared mutable state between tests.

## 4. Page objects and components

| Class | File | Locators / accessors | Actions (and what they wait for) |
|---|---|---|---|
| `LoginPage` | `pages/login-page.ts` | `emailInput`, `passwordInput`, `submitButton`, `emailError`, `passwordError`, `formError` (role=alert), `sessionExpired` | `goto()`, `login(email, password)` (works on `/login?next=…`), `loginAs(user)` (goto + login; waits for the `POST auth/login` response, throws on non-2xx, then waits until the URL leaves `/login`, i.e. the session is stored), `storedSession()` (raw `feeflow.session` or null), `sessionToken()`, `loginHoldingRequest(email, password)` (holds the `POST api/v1/auth/login` request via `page.route` so the in-flight state can be asserted; request unchanged, only timing; the test must call the returned `release()`) |
| `DashboardPage` | `pages/dashboard-page.ts` | `root`, `pageTitle` (`page-title` inside the dashboard), `totalOutstandingStat`, `overdueStat` (assert with `toContainText`: the card text includes its label), `studentCards`, `studentCard(id)`, `studentName(id)`, `studentOutstanding(id)`, `feesTable`, `feeRows`, `feeRowAt(i)`, `feeRow(feeId)`, `feeStatusBadge(feeId)` (`data-status`), `outstandingTotal`, `studentFilter` | `payFee(feeId)`, `payFirstFee()`, `waitForFees()` (table rendered; hangs if there are no unpaid fees), `filterByStudent(label)` (waits for the `GET fees/outstanding?student_id=` response; throws on non-2xx) |
| `CheckoutPage` | `pages/checkout-page.ts` | `amountForm` (amount step; replaced by a `fee-paid` alert when the fee is paid), `amountError` (one element for every amount message, shown only after a submit), `amountFullRadio`, `amountCustomRadio`, `customAmountInput`, `continueButton`, `stepAmount`, `stepCard` (class `active`), `orderSummary`, `summaryFee`, `summaryStudent`, `paymentAmount`, `paymentReference`, `card*Input`s, `payButton`, `processingOverlay`, `cancelPaymentButton` | `goto(feeId)` (opens `/fees/<feeId>/pay`, waits for `amountForm`), `chooseCustomAmount(amount)`, `continueToPayment()` (waits for `POST payments`; throws on non-2xx; not for client-side validation cases, which send no request: click `continueButton` there), `readSummary()` (`{ fee, student, reference }`), `fillCard(card)`, `submitPayment()` (clicks pay and returns `{ confirmed }` at once so the test can see the in-flight overlay; `confirmed` resolves with the confirm response whatever its status), `pay()` (submit and wait for `confirmed`) |
| `PaymentPage` | `pages/payment-page.ts` | `root` (`data-payment-status`), `successPanel`, `failurePanel`, `failureMessage`, `statusBadge` (`data-status`), `detailFailure` ("message (CODE)"), `detailAmount`, `detailMethod`, `detailReference`, `timelineEvents`, `timelineEventAt(i)` (`data-event-type`) | `backToDashboard()` (follow with `dashboardPage.waitForFees()`), `tryAgain()` (failed payment → fresh `/fees/<feeId>/pay`) |
| `FeeDetailPage` | `pages/fee-detail-page.ts` | `root`, `amountPaid`, `balance`, `statusBadge` (text label, `data-status`), all scoped to `root` | `goto(feeId)` (opens `/fees/<feeId>`, waits for `root`) |
| `TransactionsPage` | `pages/transactions-page.ts` | `root`, `table`, `rows`, `rowAt(i)` → `TransactionRow` (`referenceLink`, `fee`, `student`, `method`, `statusBadge`, `amount`; cells by column position because they have no test IDs) | `TransactionRow.open()` |
| `AppNav` (component) | `pages/components/app-nav.ts` | `dashboardLink`, `transactionsLink`, `logoutButton`, `userName` | `openTransactions()`, `logout()` |

Rules:
* Page objects hold locators, read-only accessors and UI actions. **No `expect` in page objects or components.** An action may throw a plain `Error` naming the HTTP status when the request it waits for fails, so a failure is never hidden behind a timeout.
* Waits inside actions match on method and URL, not status, and the JSDoc says what is awaited. Actions never wait for a fixed time.
* Locator priority inside page objects: `getByTestId` (see `docs/APPLICATION.md` §13 or grep `frontend/src`), then `getByRole`, then `getByLabel`; CSS only when nothing else exists (the `[data-testid^="student-card-"]` prefix list is the one case today).
* Components (`pages/components/`) are for UI shared by several screens; a page object composes a component rather than inheriting from a base class. No base pages, factories or singletons.
* Shared test data: `import { testCards } from '../test-data/cards'` (`testCards.success`, `.decline`, `.gatewayError`, `.pendingSuccess`, …, mirroring the backend's `TEST_CARDS`).

### Before adding an abstraction

1. Search `pages/`, `pages/components/`, `api-clients/`, `fixtures/index.ts` and `test-data/` for something that already covers it; prefer adding an accessor or method to an existing class.
2. Add a new page object, component, client or helper only when the case needs a screen/resource no existing one covers, or when it removes real duplication or manages a lifecycle. Name the cases that will reuse it (from the catalogue) in your report and in its JSDoc. A new page object, component, fixture or workflow helper requires thorough mode; a new **thin API client** (§5) may be added in fast mode.
3. Keep case-specific acceptance criteria out of it.

### Deferred (add with their first real case)

| Candidate | First case that needs it | Shape |
|---|---|---|
| `AuthApi` client | the first AUTH-API case; then move AUTH-UI-003/004's inline `api.post('auth/logout')`/`api.get('auth/me')` onto it | `login(body)`, `me(token)`, `logout(token)` returning `APIResponse` |
| `TransactionsApi`, more `PaymentsApi` methods (`confirm`, `cancel`, `status`) | the first PAY-API/TXN-API case that calls them | same thin style |
| Payment workflow helper (create → confirm → poll) | a PAY-API case that needs a payment only as setup, without asserting each response | plain function taking the clients |
| Checkout cancel dialog and card-error accessors | PAY-UI-006 / PAY-UI-007 | accessors on `CheckoutPage` |
| `beforeEach`/`afterEach` hooks | a file needs shared per-test setup that isn't a resource | resources and cleanup belong in fixtures (see `dev`) |

## 5. API clients

* `PaymentsApi` (`api-clients/payments-api.ts`): `create(body, idempotencyKey?)` (sends `Idempotency-Key` only when given; the body is sent as-is so strict-validation cases can add or omit fields), `get(id)`.
* `FeesApi` (`api-clients/fees-api.ts`): `outstanding({ studentId? })`, `get(id)`.
* Clients build requests and return the raw `APIResponse`; status, headers, body and business rules are asserted in the test. No generic assertion helpers.
* **Thin client definition** (the only kind fast mode may create): a stateless class that wraps an existing request context (`request`, `api` or `apiAs(…)`), with methods that only build one request and return the raw `APIResponse`: no lifecycle or disposal, no stored state, no retries, polling or multi-call workflows, no assertions. Name it `<Resource>Api` in `api-clients/<resource>-api.ts`, add a JSDoc line naming the cases that use it, and list it in this section. Anything beyond that (workflow helpers, polling, token management) needs thorough mode.
* Construct them over an authenticated context: `const payer = await apiAs(env.loadtestUser); const payments = new PaymentsApi(payer);`. Disposal is handled by `apiAs`.
* Paths are relative with no leading slash (a leading `/` drops `/api/v1`).
* Generate idempotency keys with `crypto.randomUUID()` in the test, so the test can assert the echoed header.

## 6. Locator check

`npm run check:locators` (in `tests/playwright/`) type-checks every `*.spec.ts` under `api/`, `ui/` and `hybrid/` and fails on any locator-creating or locator-selecting call made on a `Page`, `Frame`, `Locator` or `FrameLocator` value, printing `file:line`. It uses the TypeScript type checker, so comments, strings and same-named methods on other types (`Array.filter`) are not flagged, and `pages/**` is never scanned. Run it with `npm run typecheck` whenever a spec changes; validators run it too.

## 7. Authentication, data and isolation

* UI login: `loginPage.loginAs(env.testUser)`; when the login form itself is under test, use `goto()` + `login(email, password)` and assert on its locators. API login: `apiAs(user)`; use `request.post('auth/login', …)` inline only when login itself is under test.
* Every test gets a fresh browser context, so no session leaks between tests. Don't rely on another test's state or on ordering.
* `dev.reset()` re-seeds and **revokes every token**: call it before logging in, and only when the case's preconditions require it. Change simulation settings only through `dev.setSimulation()`.
* Writing tests (payments) use a `loadtestNNN@example.com` account, reset first, or (when the spec says "any unpaid fee") pay a small amount on the first unpaid fee, as TXN-UI-001 does.
* Money is shown in `en-ZA` with non-breaking spaces (`R 24 200,00`); Playwright's string text matchers normalise whitespace, so write plain spaces. `toHaveAttribute` and raw `innerText()` comparisons do not normalise.

## 8. Environment and secrets

* Use `import { env } from '../config/env'` for `env.baseUrl`, `env.apiBaseUrl` (trailing `/`), `env.testUser`, `env.secondaryUser` and `env.loadtestUser` (loadtest050 by default via `LOADTEST_USER_EMAIL`; its password is `LOADTEST_USER_PASSWORD`, falling back to `TEST_USER_PASSWORD` because all seeded accounts share it). Credentials are read lazily from `tests/playwright/.env` (copy `.env.example`), and a missing value throws a clear error.
* Never hard-code passwords, tokens or base URLs, and never log them (`sessionToken()` values included).

## 9. Commands, debugging, artifacts

Run from `tests/playwright/`:

| Goal | Command |
|---|---|
| One case (the placement command) | `npx playwright test ui/auth-ui.spec.ts --project=ui-chromium --grep AUTH-UI-004 --reporter=list` |
| Category | `npm run test:ui` · `npm run test:api` · `npm run test:hybrid` |
| By tag | `npx playwright test --grep "@auth"` |
| Typecheck + locator check (after any change) | `npm run typecheck && npm run check:locators` |
| Debug | add `--headed` or `--debug`; `npm run pw:ui` |
| Report / trace | `npm run report`; `npx playwright show-trace test-results/<test>/trace.zip` |

On failure, the trace, screenshot and video are kept in `test-results/<test>/`. The HTML report is in `playwright-report/`.

If the app is down, every test fails at setup with `Backend API is not reachable at …/health (ECONNREFUSED). Start it from the repo root with scripts\start-backend.ps1 …` (or `Frontend …` with `scripts\start-frontend.ps1`). This comes from the `appHealth` fixture; start the named server, or set `PW_START_SERVERS=true`, and re-run.

## 10. Examples (copy and adapt)

**UI, freshly seeded** (`ui/fee-ui.spec.ts`, FEE-UI-001):
```ts
import { test, expect } from '../fixtures';
import { env } from '../config/env';

test('FEE-UI-001 Dashboard shows correct outstanding fees, overdue status and totals', { tag: ['@ui', '@fees'] }, async ({ loginPage, dashboardPage, dev }) => {
  await test.step('S1 Log in as Thandi', async () => {
    await dev.reset();
    await loginPage.loginAs(env.testUser);
  });
  await test.step('S2 Read stat-total-outstanding, stat-overdue and the outstanding-fees-table', async () => {
    await expect(dashboardPage.totalOutstandingStat).toContainText('R 24 200,00');
    await expect(dashboardPage.feeRowAt(0)).toHaveAttribute('data-testid', 'fee-row-fee_1006');
    await expect(dashboardPage.feeStatusBadge('fee_1004')).toHaveAttribute('data-status', 'PARTIALLY_PAID');
  });
  await test.step('S3 Select "Lerato Mokoena" in outstanding-student-filter', async () => {
    await dashboardPage.filterByStudent('Lerato Mokoena');
    await expect(dashboardPage.outstandingTotal).toHaveText('R 10 000,00');
  });
});
```

**UI journey with an in-flight check** (`ui/pay-ui.spec.ts`, PAY-UI-001):
```ts
import { testCards } from '../test-data/cards';

await dashboardPage.payFee('fee_1006');
await checkoutPage.continueToPayment();
await expect(checkoutPage.paymentAmount).toHaveText('R 450,00');
await checkoutPage.fillCard(testCards.success);
const { confirmed } = await checkoutPage.submitPayment();
await expect(checkoutPage.processingOverlay).toBeVisible();
await expect(checkoutPage.payButton).toBeDisabled();
await confirmed;
await expect(paymentPage.root).toHaveAttribute('data-payment-status', 'SUCCEEDED');
await paymentPage.backToDashboard();
await dashboardPage.waitForFees();
await expect(dashboardPage.feeRow('fee_1006')).toHaveCount(0);
```

**UI capturing values for later comparison** (`ui/txn-ui.spec.ts`, TXN-UI-001):
```ts
await checkoutPage.chooseCustomAmount('10');
await checkoutPage.continueToPayment();
const summary = await checkoutPage.readSummary();
await checkoutPage.fillCard(testCards.success);
await checkoutPage.pay();
await appNav.openTransactions();
const newest = transactionsPage.rowAt(0);
await expect(newest.referenceLink).toHaveText(summary.reference);
await expect(newest.statusBadge).toHaveText('Successful');
```

**API, authenticated, via clients** (`api/pay-api.spec.ts`, PAY-API-001):
```ts
import { randomUUID } from 'node:crypto';
import { FeesApi } from '../api-clients/fees-api';
import { PaymentsApi } from '../api-clients/payments-api';

test('PAY-API-001 <catalogue title>', { tag: ['@api', '@payments'] }, async ({ apiAs, dev }) => {
  await test.step('Precondition: restore simulation defaults', async () => {
    await dev.restoreSimulation();
  });
  const payer = await apiAs(env.loadtestUser);
  const payments = new PaymentsApi(payer);
  const fees = new FeesApi(payer);
  const key = randomUUID();
  const res = await payments.create({ fee_id: feeId, amount_cents: 10000, payment_method: 'CARD' }, key);
  expect(res.status()).toBe(201);
  expect(res.headers()['idempotency-key']).toBe(key);
});
```

**API, login under test** (`api/auth-api.spec.ts`; the first AUTH-API case may instead add a thin `AuthApi` client, §5):
```ts
test('AUTH-API-001 <catalogue title>', { tag: ['@api', '@auth'] }, async ({ request }) => {
  await test.step('S1 Log in with valid credentials', async () => {
    const res = await request.post('auth/login', { data: { email: env.testUser.email, password: env.testUser.password } });
    expect(res.status()).toBe(200);
  });
});
```

**Changed simulation, restored in teardown** (shape for PAY-API-010):
```ts
test('PAY-API-010 <catalogue title>', { tag: ['@api', '@payments'] }, async ({ apiAs, dev }) => {
  await test.step('Precondition: shorten the simulation', async () => {
    await dev.setSimulation({ gateway_timeout_ms: 500, pending_resolution_seconds: 2 });
  });
  // S1 … no afterEach: the dev fixture runs DELETE dev/simulation after the test, pass or fail.
});
```

**Hybrid:** none. There is no catalogue Hybrid layer. UI cases with API checks stay in `ui/` and use `api`/`apiAs`.
