# CLAUDE.md – FeeFlow SDET workspace

Local practice app: FastAPI + SQLite backend (`backend/`, :8000), React + Vite frontend (`frontend/`, :5173). Testing workspace: Playwright Test (`tests/playwright/`), k6 (`tests/k6/`), test catalogue (`test-manager/`), Claude agents (`.claude/agents/`). Overview: [README.md](README.md).

## ID-Driven Test Automation Workflow

Applies whenever the user refers to a catalogue test case ID, for example:

| Request | Agents (in order) | Writes code? | Updates catalogue? |
|---|---|---|---|
| `Automate AUTH-API-001` | reader → explorer (if relevant) → engineer → validator (runs it) → updater | yes | yes |
| `Automate PAY-API-003 and run it` | same; running is mandatory | yes | yes |
| `Plan AUTH-API-001` (optionally with guidance, e.g. "…by extending the framework with an auth fixture") | reader → explorer (if relevant) → **test-planner** → stop for user review | plan file only (`tests/plans/<ID>.md`) | **no** |
| `Review AUTH-API-001 without implementing it` | reader → explorer (optional) → validator (static review of an existing script, if any; run only if asked) | **no** | **no** |
| `Debug AUTH-API-001` | reader → validator (run + classify) → engineer (fix **test defects only**) → validator → updater | test code only | yes |
| `Update AUTH-API-001: I ran it manually today, it failed – <reason>` | reader → updater (tracking fields only, from the evidence the user states; the note records "reported by user") | no | yes |
| `Implement the k6 test for <ID>` | reader (must be a Performance case) → engineer (k6) → validator (1-VU smoke only) → updater | yes | yes |

Agents live in `.claude/agents/`: `test-case-reader`, `test-planner`, `playwright-mcp-explorer`, `test-automation-engineer`, `test-validator`, `test-catalogue-updater`. Details: [.claude/README.md](.claude/README.md).

### Orchestration rules (main session = orchestrator)
1. **Resolve the exact ID first** with `test-case-reader` (`node test-manager/scripts/case.mjs show <ID>`). Not found, duplicated or ambiguous → **stop and ask the user**. Never create, rename or substitute a case. Never infer behaviour from the ID alone.
2. **Pass the reader's output verbatim** (STATUS…OPEN QUESTIONS block, including the SPEC JSON) into every later agent prompt. Agents must not re-read or reinterpret requirements independently.
3. **Explore when relevant.** UI and hybrid cases go to `playwright-mcp-explorer` using the Playwright MCP tools. API cases go to it when endpoints, schemas or messages need confirming (source/OpenAPI/curl). If MCP is unavailable for a UI case, report it (setup in `.claude/README.md`) and ask whether to continue with source-only exploration.
4. **Use an approved plan if one exists.** Before implementing, check `tests/plans/<ID>.md`. If it's `APPROVED`, pass it to the engineer and validator alongside the reader block; the engineer implements exactly that plan, including its framework changes. If it's `DRAFT`, ask the user whether to approve it, re-plan, or ignore it. If its `Catalogue updatedAt` differs from the case's current `updatedAt`, it is stale: say so and re-plan. With no plan, the engineer plans inline as before.
5. **Implement only the requested case** with `test-automation-engineer`, unless the user explicitly asks for a batch. k6 scripts are written only on an explicit k6 request.
6. **Validate with `test-validator`**, which reviews the code and runs it with the real command. Run whenever practical; it is mandatory when the user says "run".
7. **Record evidence with `test-catalogue-updater`** (CLI `update`). Never mark `automated` or `passed` without the evidence the updater's rules require.
8. **Report to the user:** files changed, the exact command(s) run and their working directory, the real result, the catalogue fields changed, and open issues.

Subagents cannot launch other subagents, so the main session calls each one in turn (Agent tool, `subagent_type` = agent name). If agent delegation is unavailable, perform the same steps directly, following each agent file as a checklist.

### Failure handling
* **App down:** report it with the startup commands (`scripts\start-backend.ps1`, `scripts\start-frontend.ps1`). Don't fake results.
* **Missing credentials or data** (e.g. `tests/playwright/.env` lacks `TEST_USER_PASSWORD`): report the blocker. Never invent or hard-code values.
* **Assertion failure:** keep the assertion and report expected vs actual with trace/screenshot paths. An app defect is a finding, not something to "fix" in the test or the app.
* **Flaky test:** investigate the cause (timing, shared data, async settlement) before touching timeouts or retries.
* **Fix loop:** after a TEST DEFECT, the engineer fixes it and the validator re-runs, at most 2 rounds. Then report.
* **Catalogue update rejected:** report the CLI error. Don't claim it was updated.

### Guardrails
* Local targets only (`localhost:5173`, `127.0.0.1:8000`). No real payment providers or external services.
* No load profiles during functional validation (k6 validation = 1 VU, 1 iteration) unless the user asks for a load run.
* `POST /api/v1/dev/reset` and `/dev/simulation` are allowed only inside tests whose preconditions require them, never during exploration without permission.
* Don't modify application code, other test cases, catalogue requirements (title/steps/expected results) or unrelated files.
* Never log or echo passwords and tokens.

### Commands
* Read a case: `node test-manager/scripts/case.mjs show <ID>`
* Run one Playwright case: `cd tests/playwright && npx playwright test --grep <ID>` (or `npx playwright test <file> --project=<api|ui-chromium|ui-mobile|hybrid>`)
* Validate the catalogue: `cd test-manager && npm run validate`

Detailed docs: [tests/playwright/README.md](tests/playwright/README.md) · [tests/k6/README.md](tests/k6/README.md) · [test-manager/README.md](test-manager/README.md) · [.claude/agents/README.md](.claude/agents/README.md)
