# Plan: PAY-API-001 – Create payment returns a PENDING payment without moving money

| Field | Value |
|---|---|
| Plan status | IMPLEMENTED |
| Requirement fingerprint | `sha256:7ba83475e27bacc2` |
| Catalogue updatedAt | 2026-10-11T19:15:32.561Z (informational; staleness uses the fingerprint) |
| Type / target | API → `api` → `tests/playwright/api/pay-api.spec.ts` (tags `@api @payments`) |
| Priority | P0 |

## Requirement (from catalogue – do not edit here)
AC1: Step 2: HTTP 201; headers Location == /api/v1/payments/{id} and Idempotency-Key echoes the sent key; no Idempotent-Replayed header.
AC2: Step 2: body status "PENDING", amount_cents 10000, currency "ZAR", fee_id == feeId, payment_method "CARD", is_final false, is_cancellable true, confirm_attempts 0, card_last4 null, reference matches ^SF-\d{8}-[0-9A-F]{6}$, id matches ^pay_[0-9a-f]{24}$.
AC3: Step 2: events == [{type: "PAYMENT_CREATED", to_status: "PENDING"}].
AC4: Step 3: HTTP 200 and identical payment.
AC5: Step 4: balance_cents unchanged from step 1 (creation does not credit the fee).

Preconditions: backend at API_BASE_URL with dev endpoints enabled; simulation settings at .env defaults (`DELETE /api/v1/dev/simulation`).
Test data: loadtest050@example.com (seeded password); fee "Term 3 Tuition" resolved via `GET fees/outstanding`; amount 10 000 cents; new UUID Idempotency-Key.

Source: `node test-manager/scripts/case.mjs show PAY-API-001`

## Observed application facts
Source: backend source, as summarised by the explorer. Nothing was executed.
- `POST auth/login {email, password}` returns 200 `{access_token, token_type, expires_at, parent}`. Protected endpoints take `Authorization: Bearer <token>`. The built-in `request` fixture sends no auth.
- `GET fees/outstanding` returns `{items: FeeOut[], count, total_outstanding_cents, overdue_cents, currency}`. For loadtest050, `items.find(f => f.description === 'Term 3 Tuition')` is unique. `FeeOut.balance_cents` is present.
- `POST payments` (strict body, extra=forbid):
  - A new key returns 201, with `Location: /api/v1/payments/{id}` (an absolute path, not a URL) and `Idempotency-Key` echoing the key verbatim.
  - `Idempotent-Replayed` is sent only on a replay (200).
  - `id` = `pay_` + 24 lowercase hex. `reference` = `SF-YYYYMMDD(UTC)-` + 6 uppercase hex.
  - At creation: currency ZAR, confirm_attempts 0, card_last4 null, is_final false, is_cancellable true.
- Each event object is `{type, from_status: null, to_status, message: "Payment created.", created_at}`. A whole-object literal match against AC3 would therefore fail; AC3 lists only `type` and `to_status`.
- `GET payments/{id}` returns 200 with a body serialised from the same DB row. A never-confirmed PENDING payment never changes (updated_at and events included), so whole-body equality with the POST body is deterministic.
- `GET fees/{feeId}` returns FeeDetail (FeeOut + `payments[]` + `has_payment_in_progress`). Only PROCESSING→SUCCEEDED credits a fee.
- `pending_resolution_seconds` applies only to PROCESSING payments after confirm, so it does not affect this case.
- Re-runs: PENDING payments accumulate without blocking. Only a PROCESSING payment on the same fee blocks creation (409 PAYMENT_IN_PROGRESS), and creation needs balance ≥ 10000 (the balance is 50 000 000).
- `DELETE dev/simulation`: no auth, returns 200 + SimulationConfig, reloads the SIM_* .env defaults, process-global.
- Header names in Playwright's `response.headers()` are lower-case (`location`, `idempotency-key`, `idempotent-replayed`).
- Password: every seeded account shares DEMO_PASSWORD, and `TEST_USER_PASSWORD` in `tests/playwright/.env` equals it. No loadtest variable exists today.

## Framework changes
Reuse check: all 15 PAY-API cases run as loadtest050 and need an authenticated API context (002, 003, 007 and 012 checked with `show`). PAY-API-006 and FEE-API-002 call `dev/reset` **before** logging in, and AUTH-API-004 needs two parents. So a fixture that logs in at setup time would be wrong for the reset cases. An on-demand **factory** fixture covers every case, and it manages the lifecycle (disposal), which the Abstraction rule accepts. The existing `api` fixture is unauthenticated and the built-in `request` has no auth, so nothing existing solves this.

| Change | File | Kind (new/modify) | Why | Reused by |
|---|---|---|---|---|
| `apiAs(user: { email: string; password: string }) => Promise<APIRequestContext>` fixture. It logs in with `POST auth/login` using a short-lived context. On a non-200 it throws `Error('Login as <email> failed: HTTP <status>')` (never the password). It returns `playwright.request.newContext({ baseURL: env.apiBaseUrl, extraHTTPHeaders: { Accept: 'application/json', Authorization: 'Bearer <token>' } })`. Every context it creates (the login context too) is pushed to an array and disposed in `finally`. JSDoc line, as the existing fixtures have. | `tests/playwright/fixtures/index.ts` | modify | S1 needs an authenticated context for 3 calls. It is called on demand, so reset-first cases can call `dev/reset` before logging in. It owns disposal. | PAY-API-002…015, FEE-API-001/002, TXN-API-001, AUTH-API-004 (two users). Not AUTH-API-001/002, where login itself is the thing under test and stays inline. |
| `env.loadtestUser { email, password }` (lazy getters, as the other users have) | `tests/playwright/config/env.ts` | modify | Gives loadtest050's credentials without hard-coding them. | all PAY-API cases |
| Docs | `tests/playwright/FRAMEWORK.md` §3 (fixture table: `apiAs`), §6 (API login via `apiAs`; the reset-then-`apiAs` order), §7 (`env.loadtestUser`), §9 (API example using `apiAs`); `tests/playwright/README.md` only if it lists the fixtures or env users | modify | The guide must match the code (FRAMEWORK.md, opening paragraph). | – |

Not proposed (kept inline): the "resolve the Term 3 Tuition fee" lookup is one GET and one `find`. It stays in each spec so the step remains visible. Revisit only if it grows past that.

Config / env changes (`tests/playwright/.env.example`, names only):
- `LOADTEST_USER_EMAIL=loadtest050@example.com`. This is non-secret spec test data, also used as the default in `env.ts` through `optional()`.
- `LOADTEST_USER_PASSWORD=`, left empty. The `env.ts` getter returns `LOADTEST_USER_PASSWORD` if it is set and otherwise falls back to `required('TEST_USER_PASSWORD')`.
  - Trade-off: the fallback works with today's `.env` with no edits, because every seeded account shares DEMO_PASSWORD. But it silently depends on that shared password.
  - A strictly required new variable is more explicit, but it makes every user edit `.env` first.
  - Recommended: the fallback, with a comment in `.env.example` explaining it. See open question 1.

No `playwright.config.ts` changes. Run `npm run typecheck` after the change.

## Test design
One test in `api/pay-api.spec.ts`: `test('PAY-API-001 Create payment returns a PENDING payment without moving money', { tag: ['@api', '@payments'] }, async ({ request, apiAs }) => …)`. Imports: `test, expect` from `'../fixtures'`, `env` from `'../config/env'`, and `randomUUID` from `'node:crypto'` (or the global `crypto.randomUUID()`). Variables shared across steps (`feeId`, `balanceBefore`, `key`, `created`, `payer`) are declared with `let` in the test body.

- **Precondition** (`test.step('Precondition: restore simulation defaults')`, first in the test body and not a hook, because the file is shared with other PAY-API tests): `await request.delete('dev/simulation')` with the unauthenticated built-in `request`, then `expect(res.status()).toBe(200)` as a setup guard so a broken precondition fails loudly and is not mistaken for an AC failure. No teardown, because the defaults are the restored state.
- **S1** Log in as loadtest050 and GET fees/outstanding; take Term 3 Tuition:
  - `payer = await apiAs(env.loadtestUser)`; `res = await payer.get('fees/outstanding')`; `expect(res.status()).toBe(200)` (guard).
  - `fee = (await res.json()).items.find(f => f.description === 'Term 3 Tuition')`; `expect(fee).toBeDefined()` (guard).
  - `feeId = fee.id`; `balanceBefore = fee.balance_cents`.
- **S2** POST payments:
  - `key = randomUUID()`; `res = await payer.post('payments', { headers: { 'Idempotency-Key': key }, data: { fee_id: feeId, amount_cents: 10000, payment_method: 'CARD' } })`; `created = await res.json()`.
  - AC1: `expect(res.status()).toBe(201)`; `expect(res.headers()['location']).toBe(\`/api/v1/payments/${created.id}\`)` (literal path from the spec); `expect(res.headers()['idempotency-key']).toBe(key)`; `expect(res.headers()['idempotent-replayed']).toBeUndefined()`.
  - AC2: `expect(created).toMatchObject({ status: 'PENDING', amount_cents: 10000, currency: 'ZAR', fee_id: feeId, payment_method: 'CARD', is_final: false, is_cancellable: true, confirm_attempts: 0, card_last4: null })`; `expect(created.reference).toMatch(/^SF-\d{8}-[0-9A-F]{6}$/)`; `expect(created.id).toMatch(/^pay_[0-9a-f]{24}$/)`.
  - AC3: `expect(created.events.map(({ type, to_status }) => ({ type, to_status }))).toEqual([{ type: 'PAYMENT_CREATED', to_status: 'PENDING' }])`. This checks the length (exactly one event), the order and both listed fields.
- **S3** GET payments/{id}:
  - `res = await payer.get(\`payments/${created.id}\`)`.
  - AC4: `expect(res.status()).toBe(200)`; `expect(await res.json()).toEqual(created)` (the whole body, every field).
- **S4** GET fees/{feeId}:
  - `res = await payer.get(\`fees/${feeId}\`)`; `expect(res.status()).toBe(200)` (guard).
  - AC5: `expect((await res.json()).balance_cents).toBe(balanceBefore)`.
- **Teardown:** the `apiAs` fixture disposes its contexts. The created PENDING payment is left in place (harmless, see below).

Guards (status checks in S1/S4, the fee lookup, the precondition 200) are not acceptance assertions. They stop the test from comparing `undefined` values and failing with a confusing message.

## Test data & isolation
- Account: loadtest050 (`env.loadtestUser`). It is the spec's dedicated writing account, kept separate from Thandi (UI tests) and from `dev/reset` cases.
- Fee: resolved by description at runtime, never by a hard-coded `fee_1170`. The balance is compared with the value read in S1, not with the catalogue's 50 000 000.
- Idempotency-Key: a new UUID per run, so the request is never a replay.
- No `dev/reset`. `DELETE dev/simulation` only, as the precondition names it.
- Cleanup: none needed. PENDING payments do not block new ones, have no per-fee limit, never auto-resolve and never credit the fee. Each run adds one PENDING row, and the 50 000 000 balance is not affected.

## Risks & flakiness controls
- **Concurrent k6 run** (k6 defaults to loadtest001..050, `tests/k6/lib/config.js`): a k6 payment on Term 3 Tuition could change `balance_cents` between S1 and S4 or cause a 409 from a PROCESSING payment. Mitigation: never run k6 and this suite together. Workers=1 already serialises Playwright.
- **Another Playwright test confirming a payment on the same fee** (PAY-API-007 and later) could leave a PROCESSING payment. With workers=1 tests run one at a time, and those tests settle their own payments. If a 409 appears, it points to leftover state from another case, not a defect in this one.
- **Process-global simulation:** the DELETE affects the whole backend. That is harmless, since it restores the defaults.
- **Timing:** none. PENDING never auto-resolves, and `gateway_latency_ms` applies only to confirm. No polling or sleeps are needed.
- **Header casing:** read headers through `res.headers()` with lower-case names.
- **Location form:** the server sends the absolute path, not a full URL. Compare it with the literal `/api/v1/payments/<id>`. If `API_BASE_URL` ever pointed at a different prefix, this assertion would fail, which is correct, since the spec fixes the value.
- **Date in the reference:** the regex only checks 8 digits, so a run around UTC midnight is not a problem.

## Execution
`cd tests/playwright && npx playwright test api/pay-api.spec.ts --project=api --grep PAY-API-001 --reporter=list`
Run `npm run typecheck` first, because `fixtures/index.ts` and `config/env.ts` change. Backend must be running (`scripts\start-backend.ps1`).

## Open questions / spec mismatches
1. **Password source:** should `LOADTEST_USER_PASSWORD` fall back to `TEST_USER_PASSWORD` (recommended; works today because all seeded accounts share DEMO_PASSWORD), or be strictly required?
2. **Setup guards:** confirm that the extra status checks (precondition 200, S1/S4 200, fee found) are acceptable as setup guards, given the "no extra assertions" rule. The alternative is to drop them and accept less clear failures.
3. **Fixture scope:** should `apiAs` be added now (recommended; 15+ cases need it), or should PAY-API-001 log in inline and the fixture wait until the second case? The guide's "add only when two or more tests reuse it" is satisfied by named, planned cases, but none of them is implemented yet.

## Approval
- [x] Approved by user on 2026-10-12 ("approve the plan for PAY-API-001"), as written. The open questions are settled by the plan's recommendations:
  1. `LOADTEST_USER_PASSWORD` falls back to `TEST_USER_PASSWORD`.
  2. The setup guards (precondition 200, S1/S4 200, fee found) are kept as an approved exception to the "no extra assertions" rule.
  3. `apiAs` is added now, with PAY-API-001.

## Implementation evidence
Reviewed 2026-10-12 by the test-validator (Review request; no code changes):
- Expected-result coverage: **COMPLETE**. All 19 parts of AC1–AC5 are asserted in `tests/playwright/api/pay-api.spec.ts`, which is the catalogue `scriptPath`.
- `npx playwright test api/pay-api.spec.ts --project=api --grep PAY-API-001 --reporter=list` (cwd `tests/playwright`): `1 passed (823ms)`; with `--repeat-each=3`: `3 passed (2.3s)`.
- `npm run typecheck` and `npm run check:locators` pass.
- The implementation follows the test design above. Only the mechanics changed in the 2026-10-12 framework refactor: `dev.restoreSimulation()` replaces the raw `DELETE dev/simulation` (same 200 guard), and `PaymentsApi`/`FeesApi` replace the raw `payer.get/post` calls (same paths, headers and bodies). Every assertion is unchanged.

## Revision history
- 2026-10-12 DRAFT created by test-planner
- 2026-10-12 APPROVED by user; open questions resolved per the recommendations
- 2026-10-12 Catalogue revision refreshed: `Requirement fingerprint` sha256:7ba83475e27bacc2 added, `Catalogue updatedAt` 2026-10-11T14:46:17Z → 2026-10-11T19:15:32.561Z. The requirement fields (title, preconditions, test data, steps, expected results) are unchanged: the fingerprint is identical at both revisions (git f95e14a and 06a8daf), and AC1–AC5 above still match the catalogue verbatim. The newer `updatedAt` came from tracking-only updates.
- 2026-10-12 Implementation evidence recorded (see above); the implementation uses the current `PaymentsApi`/`FeesApi` clients and the `dev` fixture.
- 2026-10-12 IMPLEMENTED by the orchestrator: validator PASSED with complete expected-result coverage, test at the catalogue `scriptPath`, plan fresh (`case.mjs plan PAY-API-001`).
