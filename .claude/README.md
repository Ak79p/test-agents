# Claude Code setup for the testing workspace

This folder holds the project's Claude Code agents. The workflow rules live in the root [CLAUDE.md](../CLAUDE.md) (section "ID-Driven Test Automation Workflow"). This page explains how the pieces fit together and how to fix them when something breaks.

## Agents

| Agent | Responsibility | Tools |
|---|---|---|
| `test-case-reader` | Resolve an exact ID and return the verbatim spec + acceptance criteria | Bash, Read, Grep, Glob (read-only use) |
| `test-planner` | For `Plan <ID>`: write a reviewable implementation plan (framework changes, step→code, AC→assertions) to `tests/plans/<ID>.md` | Read, Grep, Glob, Bash, Write (plan file only) |
| `playwright-mcp-explorer` | Observe the real app: Playwright MCP for UI, source/OpenAPI/curl for API | Read, Grep, Glob, Bash, selected `mcp__playwright__*` tools |
| `test-automation-engineer` | Write the one requested test in `tests/playwright/` (or k6 on request) | Read, Write, Edit, Grep, Glob, Bash |
| `test-validator` | Review against the spec, run the test, classify failures | Read, Grep, Glob, Bash (no file editing) |
| `test-catalogue-updater` | Record status, path, result, date and notes through the catalogue CLI | Bash, Read |

Inputs, outputs and boundaries for each agent: [agents/README.md](agents/README.md).

## Orchestration sequence and how the ID flows

Plain `Automate <ID>` runs in **fast mode** when existing page objects, clients and fixtures cover the case and its behaviour is understood (a `dev.reset()` before login or `dev.restoreSimulation()` doesn't by itself rule it out). The main session does everything itself, with no subagents: it reads the case with `case.mjs show`, reuses the framework, implements the test, runs it once plus `npm run typecheck` and `npm run check:locators`, allows one targeted fix, and records the result with one `case.mjs update`. MCP is used only when a locator or behaviour is unknown. See CLAUDE.md → "Choosing the mode" and "Fast mode". Fast mode may also add a thin API client, and when the case is already automated it first checks every expected result against the existing assertions. The multi-agent sequence below is **thorough mode** (`Automate thorough <ID>` always forces it): simulation changes, idempotent replay/conflict or concurrent requests, several identities, a missing page object/component/fixture/helper, an observation window or a wait over 10 s, a coverage gap in an existing test, an ambiguous spec, an unexplained failure, or a `DRAFT`/`APPROVED` plan. Exploration is source-only by default when a browser walk-through would need credentials, and it never changes data other cases depend on. Plan, Review, Debug, Update and k6 requests also use the agents.

```
user: "Automate thorough AUTH-API-001"
        │
        ▼
main session (orchestrator, follows CLAUDE.md)
  1. test-case-reader ──► "STATUS: FOUND … SPEC (verbatim JSON) … ACCEPTANCE CRITERIA AC1..n"
        │  NOT_FOUND / DUPLICATED → stop, ask the user
  2. playwright-mcp-explorer ◄── reader block (verbatim) + what the framework already covers   [only for gaps]
        └─► verified locators, messages, endpoints, SPEC MISMATCHES
  3. test-automation-engineer ◄── reader block + explorer findings
        └─► files, project, run command, AC → assertion mapping
  4. test-validator ◄── reader block + engineer report
        └─► review checklist, RESULT, exact command, evidence
        (TEST DEFECT → back to 3, max 2 rounds; APP DEFECT/SPEC ISSUE → report)
  (for "Plan <ID>": 1 → 2 → test-planner writes tests/plans/<ID>.md (DRAFT) and the flow stops;
   a later "Automate <ID>" gives the APPROVED plan to the engineer and validator; after a PASSED run with
   complete coverage the orchestrator marks the plan IMPLEMENTED)
  5. test-catalogue-updater ◄── ID + engineer + validator reports
        └─► catalogue fields changed, verified by read-back
        │
        ▼
final report to the user
```

The reader's block is the only source of requirements. Every later agent gets it verbatim, so no agent reinterprets the test case on its own. Subagents can't call each other; the main session passes the outputs along.

## Playwright MCP

MCP is for **agent-driven exploration** of the running app (the explorer agent). **Playwright Test** (`tests/playwright/`) is for permanent, repeatable tests. The two are configured separately: MCP lives in your Claude Code config, while the test framework lives in `tests/playwright/playwright.config.ts`.

### Current registration (verified on this machine)
```
claude mcp get playwright
  Scope: Local config (private to you in this project)
  Status: √ Connected
  Command: cmd
  Args: /c npx -y @playwright/mcp@0.0.82 --isolated
```
Stored in `~/.claude.json` under this project (local scope), so nothing machine-specific is committed. The server exposes tools such as `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, `browser_network_requests`, `browser_take_screenshot` and `browser_close`. In Claude Code they are named `mcp__playwright__<tool>`.

### Install on another machine
Check first, to avoid duplicates: `claude mcp get playwright` (or `claude mcp list`). Add it only if it reports no server named "playwright".

| Shell | Command |
|---|---|
| macOS / Linux | `claude mcp add playwright -- npx -y @playwright/mcp@0.0.82 --isolated` |
| Windows **PowerShell** | `claude mcp add playwright -- cmd /c npx -y @playwright/mcp@0.0.82 --isolated` |

Notes:
* The official minimal form is `claude mcp add playwright npx @playwright/mcp@latest`. The commands above add:
  * `cmd /c`, which native Windows needs to launch `npx`;
  * `-y`, so `npx` never waits on an install prompt;
  * `--isolated`, a fresh in-memory browser profile, so no stale logins between sessions;
  * a pinned version, for reproducible exploration. Moving to `@latest` is fine once you've checked the release.
* **Don't run the Windows command from Git Bash.** MSYS path conversion turns `/c` into `C:/` and the server fails to connect ("Request timed out"). This happened during setup. Fix: `claude mcp remove playwright -s local`, then re-add from PowerShell.
* **Browser:** by default the server uses the installed **Google Chrome** (`chrome` channel). It is present here and verified headless. Alternatives: append `--browser msedge` (Edge is installed), or `--browser chromium` plus `npx playwright install chromium`. Add `--headless` to hide the window.
* **Node.js:** 18+ is required; v22.23.1 is installed.
* New MCP servers load when a Claude Code session starts. **Restart Claude Code** (or use `/mcp` → reconnect) after adding one.

### Verify the connection
1. In a terminal: `claude mcp list` should show `playwright: … ✔ Connected`.
2. Inside Claude Code: run `/mcp`. `playwright` should be listed as connected, with its tools.
3. Ask Claude: "Use Playwright MCP to open http://localhost:5173/login and describe the form". It should call `mcp__playwright__browser_navigate` and `browser_snapshot`.

## Planning (`Plan <ID>`) vs Playwright's built-in planner

`Plan <ID>` uses this repo's **test-planner** agent. It takes the catalogue case as fixed, plans *how* to implement it (framework changes such as new fixtures or helpers, step→code, AC→assertion, data isolation, risks) and saves `tests/plans/<ID>.md` for your approval. See [tests/plans/README.md](../tests/plans/README.md).

Playwright 1.56+ also ships official agents (`npx playwright init-agents --loop=claude`). A trial run against a scratch copy of this framework (Playwright 1.63) generated:
* `.claude/agents/playwright-test-{planner,generator,healer}.md`;
* a `.mcp.json` registering a second MCP server, `playwright-test` (`npx playwright run-test-mcp-server`);
* `api/seed.spec.ts`;
* `specs/`.

It was **not** installed here because:
* the official planner explores the app and **writes its own scenarios** into `specs/`, which would be a second source of requirements next to the catalogue;
* the healer edits failing tests automatically, which conflicts with the "never weaken assertions" rule;
* it writes into the directory it's run from, which isn't the repo root here.

If you want it for *discovering* new scenarios, run it in a separate scratch checkout. Then add the scenarios you accept to the catalogue with new IDs, and automate them through this workflow.

## Adding or updating an agent
1. Create or edit `.claude/agents/<name>.md` with YAML frontmatter:
   * `name`: kebab-case, unique.
   * `description`: when to use it. Claude reads this to choose the agent.
   * `tools`: comma-separated allow-list. Omit it to inherit all tools.

   The body is the system prompt: inputs, procedure, output format and boundaries.
2. Keep one responsibility per agent and a fixed output format, because the orchestrator passes outputs between agents.
3. MCP tools must be listed by full name (`mcp__playwright__browser_click`).
4. Update [agents/README.md](agents/README.md), and the CLAUDE.md table if the sequence changes.
5. Agents are loaded at session start. Restart Claude Code, then ask Claude "Without using tools, list the subagent types available to you". In this Claude Code version the `/agents` wizard has been removed, so agents are managed only as files. Headless check: `claude -p "Without using tools, list your subagent types" --max-turns 1`.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Agent not found / never used | Check that the file is in `.claude/agents/`, has valid frontmatter (`---` lines, `name`, `description`) and that you restarted the session. Verify by asking Claude to list its subagent types (the `/agents` wizard no longer exists). Ask explicitly: "Use the test-case-reader agent for AUTH-API-001". |
| Agent says a tool is unavailable | The tool isn't in its `tools:` list (by design for reader/validator/updater), or the MCP server isn't connected (`/mcp`). |
| Explorer reports `MCP_UNAVAILABLE` | Run `claude mcp get playwright`. If it isn't connected, see "Install on another machine" above and restart Claude Code. |
| MCP browser fails to launch | Chrome is missing → add `--browser msedge`, or install Chrome. Corporate policy blocking automation → try `--browser chromium` after `npx playwright install chromium`. |
| Permission prompts for every command | Use `/permissions` to allow `Bash(node test-manager/scripts/case.mjs:*)` and `Bash(npx playwright test:*)` for this project. |
| Catalogue update rejected | The CLI prints the validation rule (e.g. "an automated test needs a scriptPath"). Fix the inputs; never hand-edit the JSON. |
| App unavailable | Start it: `scripts\start-backend.ps1` and `scripts\start-frontend.ps1` (macOS: `bash scripts/start-*.sh`). |
