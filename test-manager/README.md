# Test manager: local test catalogue

A small, dependency-free web app for browsing and tracking the FeeFlow test cases. It needs no account, database or external service: a small Node server persists everything to a JSON file in this folder.

```
test-manager/
├── server.mjs              Node built-ins only; serves the UI and the JSON API
├── lib/catalogue.mjs       schema + validation (used by the server, the CLI and the browser)
├── lib/store.mjs           atomic file persistence (shared by server and CLI)
├── public/                 index.html, app.js, styles.css (vanilla JS, no build step)
├── data/catalogue.json     ← the catalogue (source of truth, committed to git)
├── scripts/case.mjs        CLI: show / list / update one case (used by Claude's agents)
└── scripts/validate.mjs    validates catalogue.json
```

## Run

Requires Node.js 18+ (no `npm install` needed).

```bash
cd test-manager
npm start                  # → http://127.0.0.1:5180
npm run validate           # schema check of data/catalogue.json
```

Change the port with `TEST_MANAGER_PORT=5181` (PowerShell: `$env:TEST_MANAGER_PORT=5181; npm start`).

## Features

* A searchable table. Search covers ID, title, objective, risk, steps, expected results, references, notes and script path; all words must match.
* Filters for layer, priority, automation status and latest result. Filters are kept in the URL, so filtered views can be bookmarked. Click a column header to sort.
* Click a row (or open `/#PAY-API-003`) to see the full procedure: objective, risk, preconditions, test data, numbered steps, numbered expected results and references.
* **Execution & tracking** form: automation status, latest result, last executed date, script path and notes. Choosing a result fills in today's date if none is set.
* **Edit content**: change title, layer, priority, target and all procedure text. **The ID can never be changed**; the server rejects any attempt.
* **Export JSON** downloads `test-catalogue-YYYY-MM-DD.json`. **Import JSON** validates the file, shows how many IDs will be added or removed, asks for confirmation and then replaces the catalogue.
* Summary counters: totals per layer, automated, passed, failed and not run.

## Data model

Each entry in `data/catalogue.json` → `tests[]`:

| Field | Type / values |
|---|---|
| `id` | `^[A-Z]+-(API\|UI\|PERF)-\d{3}$`, e.g. `PAY-API-003`. **Permanent.** |
| `title`, `objective`, `risk` | non-empty strings |
| `layer` | `API` · `UI` · `Performance` |
| `priority` | `P0` · `P1` · `P2` |
| `preconditions`, `testData`, `references` | string arrays |
| `steps`, `expectedResults` | non-empty string arrays (numbered in the UI) |
| `automationStatus` | `planned` · `in progress` · `automated` |
| `automationTarget` | `Playwright` (API/UI) · `k6` (Performance) |
| `scriptPath` | repo-relative path, empty until automated |
| `latestResult` | `not run` · `passed` · `failed` · `blocked` |
| `lastExecuted` | `YYYY-MM-DD` or `null` |
| `notes` | string |
| `updatedAt` | ISO timestamp, set by the server |

Validation rules beyond types: IDs are unique; API and UI cases target Playwright and Performance cases target k6; `automated` requires a `scriptPath`.

**ID convention:** `<AREA>-<LAYER>-<NNN>`, where AREA is `AUTH`, `FEE`, `PAY` or `TXN`. New cases take the next free number in their AREA-LAYER group. Numbers are never reused, even if a case is deleted.

## Statuses

| Field | Value | Meaning |
|---|---|---|
| `automationStatus` | `planned` | Specified, no script yet |
| | `in progress` | A script exists but isn't finished, or couldn't be validated (blocked / not run) |
| | `automated` | The script exists at `scriptPath` and implements every expected result |
| `latestResult` | `not run` | Never executed |
| | `passed` / `failed` | Outcome of the last real execution (`lastExecuted` = its date) |
| | `blocked` | Couldn't execute (missing credentials, data or app) |

Results describe the **last execution**, not the quality of the script: a correct test that exposes an app defect is `automated` + `failed`.

## Automation paths and evidence

* `scriptPath` is repo-relative, for example `tests/playwright/api/auth/AUTH-API-001.spec.ts` or `tests/k6/scripts/FEE-PERF-002.js`.
* `lastExecuted` holds the date (YYYY-MM-DD). The time, the exact command and the evidence summary go into `notes` as timestamped lines, e.g. `[2026-10-12 10:04 UTC+05:30] passed via: npx playwright test api/auth/AUTH-API-001.spec.ts --project=api | 1 passed (0.9s)`.

## CLI (how Claude reads and updates cases)

```bash
node test-manager/scripts/case.mjs show AUTH-API-001                 # full case as JSON (exact ID match)
node test-manager/scripts/case.mjs list --layer UI --status planned  # filtered list
node test-manager/scripts/case.mjs update AUTH-API-001   --automation-status automated   --script-path tests/playwright/api/auth/AUTH-API-001.spec.ts   --result passed --executed today   --note "passed via: npx playwright test … | 1 passed"
```
* `update` changes **tracking fields only** (`automationStatus`, `scriptPath`, `latestResult`, `lastExecuted`, `notes`). `--note` appends a timestamped line and keeps existing notes; `--notes` replaces them. Requirements (title, steps, expected results) are edited only by you in the web UI.
* Every update is validated (e.g. `automated` requires a `scriptPath`) and written atomically through the same store as the web server, so the CLI is safe while the server runs. Reload the browser tab to see CLI changes.
* Exit codes: `0` ok, `1` invalid usage/update (catalogue unchanged), `2` ID not found, `3` ID duplicated.

## Requesting automation by ID

In Claude Code, say `Automate AUTH-API-001` (or `Plan …`, `Review …`, `Debug …`, `Implement the k6 test for …`). `Plan <ID>` writes an implementation plan to [`tests/plans/`](../tests/plans/README.md) without changing the catalogue. Claude follows the [ID-Driven Test Automation Workflow](../CLAUDE.md#id-driven-test-automation-workflow): it reads the case with `show`, explores the app, writes the test, runs it, and records the evidence with `update`.

**Missing or ambiguous IDs.** Lookups are exact and case-sensitive. If the ID doesn't exist (exit 2), the CLI lists IDs with the same prefix and Claude stops and asks you; it never picks a "close" case or invents one. If an ID is duplicated (exit 3, only possible through hand edits or an import that skipped validation), fix the catalogue first. To add a missing case, add it yourself (edit or import JSON) with the next free number in its group.

## Persistence and limitations

* **The file is the database.** Every save rewrites `data/catalogue.json` atomically (temp file, then rename) and keeps the previous version in `data/catalogue.backup.json` (git-ignored). Changes survive page refreshes, browser restarts and server restarts, and they show up in `git diff`.
* **Single user, single machine.** There are no accounts and no locking between people. The server serialises writes, so two browser tabs won't corrupt the file. A per-test save only changes that test, but whole-catalogue imports overwrite everything.
* **Last write wins per test.** If you edit a test in two tabs, the later save overwrites the earlier one. Click **Reload** (or switch back to the tab, which reloads automatically) to pick up edits made in another tab or directly to the file.
* **The server must be running.** Opening `public/index.html` directly from disk will not work, and nothing is stored in browser storage.
* **Only the last result is tracked.** Each case stores one `latestResult`, `lastExecuted` and `notes`. There is no run history beyond `git log` of the JSON file. Export snapshots if you want to keep a history.
* Binds to `127.0.0.1` only. It is not intended to be exposed on a network.
