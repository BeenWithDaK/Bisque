# Bisque Milestone 1 Plan (Explore & Plan Only)

**Source of truth:** local checkout of `https://github.com/BeenWithDaK/Bisque.git` (fork of `earendil-works/pi`), MIT licensed. Working tree at `/Users/benkraft/Documents/Bisque` (empty git init; content inspected via GitHub API raw URLs — no `git clone`/`git fetch` possible in this environment).

**Goal:** Document findings and propose an implementation-ready plan for Milestone 1. No source changes are made by this plan.

---

## 1. Repo inspection summary

### Monorepo layout (root `package.json`)
Workspaces: `packages/*`, `apps/*`, plus a few example extension dirs. Relevant packages:

| Package | Role |
|---|---|
| `packages/coding-agent` | `@earendil-works/pi-coding-agent` — interactive coding agent CLI (the TUI/shell Bisque wraps/replaces) |
| `packages/agent` | `@earendil-works/pi-agent-core` — agent runtime, tool calling, state management (kept as-is) |
| `packages/ai` | `@earendil-works/pi-ai` — unified multi-provider LLM API (kept as-is) |
| `packages/tui` | `@earendil-works/pi-tui` — terminal UI library (kept as-is) |
| `packages/chord`, `packages/durable`, `packages/telemetry`, `packages/env` | supporting runtimes (not touched by Milestone 1) |
| `apps/p2`, `apps/p2-mac` | separate Pi applications (out of scope) |

Build/test/lint scripts (root `package.json`):
- `npm run build` — builds all packages in order (telemetry → schema → chord → tui → codemode → mcp → ai → durable → env → agent → coding-agent)
- `npm run build:offline` — same without refreshing model catalog
- `npm run check` — biome `--write`, pinned-deps, runtime-deps, ts-imports, entry-graphs, install-lock check, `tsc --noEmit` (root + examples)
- `./test.sh` — runs `packages/*` tests (skips LLM-dependent e2e without API keys)
- Linter: `@biomejs/biome` 2.3.5; TypeScript 7.0.2; Node >=22.19

### Extension API (`packages/coding-agent/src/core/extensions/types.ts`, `runner.ts`)
Extensions are TS modules exporting `default function (pi: ExtensionAPI)`. Core capabilities:

- `pi.on(eventType, handler)` — subscribe to lifecycle events
- `pi.registerTool(definition: ToolDefinition)` — register an LLM-callable tool (`name`, `label`, `description`, `parameters` (TypeBox), `execute(toolCallId, params, signal, onUpdate, ctx)`, optional `renderCall`/`renderResult`, `exposure`, `annotations`)
- `pi.registerCommand(command)` — register a slash command (`name`, `description`, `argumentHint`, optional `getArgumentCompletions`)
- `pi.registerFlag(name, {description, type})` — register a CLI flag; read via `pi.getFlag(name)`
- `ExtensionUIContext` (from `ctx.ui`): `select(title, options, opts?)`, `confirm(title, message, opts?)`, `input(title, placeholder?, opts?)`, `notify(message, type?)`, `setStatus(key, text \| undefined)`, `setWidget(key, content, {placement: "aboveEditor" \| "belowEditor"})`, `setFooter(factory)`, `setHeader(factory)`, `custom(factory, opts)`, `addAutocompleteProvider(factory)`, `setEditorComponent`, `pasteToEditor`, `setEditorText/getEditorText`, `theme`
- `ExtensionContext`: `ui`, `mode` ("tui"\|"rpc"\|"json"\|"print"), `hasUI`, `cwd`, `sessionManager`, `modelRegistry`, `model`, `scopedModels`, `signal`, `abort()`, `shutdown()`, `getContextUsage(): ContextUsage \| undefined` (`{tokens, contextWindow, percent}`), `compact(options)`, `getSystemPrompt()`, `isIdle()`, `isProjectTrusted()`
- `ExtensionToolContext` extends `ExtensionContext` with `tools: readonly AgentTool[]` and `executeTool(name, args, options?)`
- `ExtensionCommandContext` extends `ExtensionContext` with `getSystemPromptOptions()`, `waitForIdle()`, `newSession()`, `fork()`, `navigateTree()`, `switchSession()`, `reload()`

Key lifecycle events (concrete names used by `ExtensionRunner.emit*` / `AgentSession`):
- `session_start` — session started/loaded/reloaded (SSH example resolves config here)
- `before_agent_start` — before each LLM run; handler receives mutable `systemPrompt` + `systemPromptOptions` (can force system prompt)
- `turn_start` / `turn_end` — turn boundaries; `turn_end` carries `BoundaryState` (entries, continue, context, outcome) — extensions can inject `SessionBoundaryDraft` entries and request `continue`
- `agent_start` / `agent_end` / `agent_settled` / `agent_before_settle`
- `tool_call` (`ToolCallEvent`) — fired before a tool executes; handler may return `{ block: true, reason }` or mutate `event.input` in place (no re-validation after mutation)
- `tool_result` (`ToolResultEvent`) — fired after; handler may replace `content`, `details`, `structuredContent`, `isError`, `usage`
- `tool_execution_start/update/end` — per-tool-call execution tracking
- `input` (`InputEvent`) — user input before agent processing; result `{action:"continue"}` | `{action:"transform", text}` | `{action:"handled"}`
- `user_bash` (`UserBashEvent`) — `!`/`!!` commands; handler returns `{operations}` or `{result}` to route execution, or `undefined` for local
- `context` / `context_with_system` — transform messages before the provider request
- `before_provider_request` / `before_provider_headers` — mutate request payload/headers
- `message_start/update/end`, `resources_discover`, `project_trust`, `session_before_switch/fork/compact/tree`

### Slash-command system (`packages/coding-agent/src/core/slash-commands.ts`)
`BUILTIN_SLASH_COMMANDS`: settings, model, tree, thinking, scoped-models, export, import, share, bug, copy, name, session, changelog, hotkeys, fork, clone, trust, login, logout, new, compact, resume, reload, quit. Each: `{name, description, argumentHint?}`. Extension commands come from `session.extensionRunner.getRegisteredCommands()` (source: "extension" \| "prompt" \| "skill"). Autocomplete provider (`interactive-mode.ts:createBaseAutocompleteProvider`) merges built-in commands, prompt templates (`/name args`), extension commands, and skill commands (`/skill:name`).

### Agent session / turn lifecycle (`packages/coding-agent/src/core/agent-session.ts`)
- `AgentSession` owns the turn loop: `turn_start` → agent run (`agent_start` → provider request → tool calls → `agent_end` → `agent_settled`) → `turn_end` → next turn.
- `_installAgentToolHooks` installs `agent.beforeToolCall`/`afterToolCall`, which call `runner.emitToolCall`/`emitToolResult` — the extension interception point for permission gating and result screening.
- `_dispatchTurnEndBoundary` emits `turn_end`; extensions can append boundary drafts and set `continue`. `finishTurn` respects extension `continue`.
- `_installAgentNextTurnRefresh` rebuilds system prompt + tool loadout each turn via `buildSystemPromptState`/`normalizeBuildSystemPromptOptions`.
- `getContextUsage()` returns `{tokens, contextWindow, percent}` for the active model.
- `before_agent_start` handlers can mutate `systemPrompt` and `systemPromptOptions` (the coworker persona prompt goes here).

### TUI wiring (`packages/coding-agent/src/modes/interactive/interactive-mode.ts`, `tui-renderer.ts`)
`InteractiveMode` mounts a fixed component tree (in `init()`):
```
documentContainer = [headerContainer, loadedResourcesContainer, chatContainer]
pendingMessagesContainer
statusContainer
widgetContainerAbove          <-- extension widgets (aboveEditor)
editorContainer               <-- input editor
widgetContainerBelow          <-- extension widgets (belowEditor)
footerContainer               <-- FooterComponent
```
- `FooterComponent` (`components/footer.ts`) renders model, thinking level, context usage (`formatTokens`), git branch, and extension statuses (from `FooterDataProvider`, which consumes `ctx.ui.setStatus(key, text)` values).
- `StatusIndicator` components: `IdleStatus`, `WorkingStatusIndicator`, `RetryStatusIndicator`, `BranchSummaryStatusIndicator`, `CompactionStatusIndicator` (`components/status-indicator.ts`).
- `setWidget(key, content, {placement})` renders extension widgets above/below the editor (the Goal bubble goes aboveEditor).
- `setFooter(factory)` / `setHeader(factory)` replace built-in footer/header (the Status bar can be a custom footer or a belowEditor widget).
- `BuiltInHeader` shows logo + keybindings + changelog at startup.
- `ProgramStatusReporter` reports OSC 7501 terminal status.

### Path protection / trust (`packages/coding-agent/src/core/trust-manager.ts`)
- `ProjectTrustStore` persists decisions to `<agentDir>/trust.json`; `ProjectTrustDecision` = `true` \| `false` \| `null` (session-only).
- `hasTrustRequiringProjectResources(cwd)` gates project-local resources (`.pi/settings.json`, `.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/themes`, `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, or `.agents/skills` in cwd or ancestors).
- Trust UI: `/trust` command; `ProjectTrustStore.get/set/setMany`.

### Usage totals (`packages/coding-agent/src/core/usage-totals.ts`)
- `UsageTotals`: `{input, output, cacheRead, cacheWrite, cost}`.
- `Usage` (from `@earendil-works/pi-ai/compat`): `{input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost: {input, output, cacheRead, cacheWrite, total, totalFromProvider?}}`.
- `getUsageCostBreakdown(entries)` groups usage by `provider/model`.
- **No built-in concept of time-windowed limits (5-hour, weekly, monthly)** — `Usage` carries cost/tokens only. This is an open gap for the Status bar "API provider usage remaining" requirement.

### Skills (`packages/coding-agent/src/core/skills.ts`)
Markdown files with frontmatter (`name`, `description`, `disable-model-invocation`). Loaded from global (`agentDir/skills/`), project (`cwd/.pi/skills/`), and explicit paths. `formatSkillsForPrompt()` emits XML `<available_skills>` for the system prompt. Registered as `/skill:name` commands when `enableSkillCommands`.

### Prompt templates (`packages/coding-agent/src/core/prompt-templates.ts`)
Markdown files with frontmatter (`name`, `description`, `argument-hint`). Loaded from global (`agentDir/prompts/`), project (`cwd/.pi/prompts/`), explicit paths. `expandPromptTemplate(text, templates)` expands `/name args` with `$1`, `$@`, `${N:-default}` substitution.

### Settings (`packages/coding-agent/src/core/settings-manager.ts`, `settings-schema.ts`)
- Global: `<agentDir>/settings.json`; Project: `cwd/.pi/settings.json` (only writable when `projectTrusted`).
- Deep merge (global + project). Typed schema via TypeBox. Getters/setters per field persist to global settings.
- No existing safety / decision-model / prompt-guard / granted-folders settings.

---

## 2. Existing examples audit

All under `packages/coding-agent/examples/extensions/`:

| Example | What it does | Relevance to Bisque |
|---|---|---|
| `ssh.ts` | Registers `--ssh` flag; overrides `read`/`write`/`edit`/`bash` tools via `pi.registerTool` to route through `spawn("ssh", ...)`. Resolves config in `session_start` (runs `pwd` on remote if no path given). Modifies system prompt in `before_agent_start`. Routes `!` commands via `user_bash` hook. Uses `ctx.ui.setStatus`/`notify`. | **Direct template for build-flagged SSH tool routing.** Confirms model API calls + auth stay on host; only tool execution is remote. |
| `permission-gate.ts` | `tool_call` hook; blocks `bash` commands matching `rm -rf`, `sudo`, `chmod/chown 777`. Confirms via `ctx.ui.select`; returns `{block: true, reason}` to block. | **Template for the permission gate.** Same hook pattern Bisque's Decision Model / manual-approve gate will use. |
| `protected-paths.ts` | `tool_call` hook; blocks `write`/`edit` to `.env`, `.git/`, `node_modules/`. Notifies via `ctx.ui.notify`, returns `{block: true, reason}`. | **Template for path protection.** Bisque's granted-folder check uses the same hook. |
| `status-line.ts` | Listed; likely demonstrates `setStatus`. | Reference for status-bar text. |
| `widget-placement.ts` | Listed; demonstrates `setWidget` placement above/below editor. | Reference for Goal bubble placement. |
| `custom-header.ts` / `custom-footer.ts` | Listed; demonstrate `setHeader`/`setFooter`. | Reference for replacing the status/footer bar. |
| `commands.ts` | Listed; demonstrates registering extension slash commands. | Reference for `/safety`, `/goal`, etc. |
| `confirm-destructive.ts` / `timed-confirm.ts` | Listed; confirmation patterns. | Reference for manual-approve UX. |

---

## 3. Bisque extension-point mapping

| Bisque requirement | Existing extension point? | Needs new extension point? | Requires core change? | Notes / concrete location |
|---|---|---|---|---|
| Plain-language shell & coworker persona/prompting | Yes — `before_agent_start` (mutate system prompt), `registerTool`, skills/prompt templates | New Bisque extension package | No | `packages/coding-agent/src/core/system-prompt.ts:buildSystemPromptSections`; inject via `before_agent_start` |
| Unified slash-command system | Yes — `pi.registerCommand`, `BUILTIN_SLASH_COMMANDS` | No (Bisque commands are extension commands) | No | `packages/coding-agent/src/core/slash-commands.ts` |
| Safe agent-callable configuration tools | Yes — `pi.registerTool` + `SettingsManager` writes + `projectTrusted` gate | No, but privilege boundaries enforced in Bisque extension code | No (enforced in extension) | `packages/coding-agent/src/core/settings-manager.ts`, `trust-manager.ts` |
| Onboard Bisque guide/help tool | Yes — `pi.registerTool` (custom tool that prints slash-command instructions) | No | No | New tool in Bisque extension |
| Goal bubble (above prompt bar) | Yes — `ctx.ui.setWidget(key, content, {placement: "aboveEditor"})` | No | No | `interactive-mode.ts` mounts `widgetContainerAbove` before editor |
| Turn-end goal-completion verification | Yes — `turn_end` / `agent_before_settle` / `agent_settled` boundary events | No | No | `agent-session.ts:_dispatchTurnEndBoundary`, `emitBoundary` |
| Status bar (below prompt bar): confirmation method | Yes — `ctx.ui.setFooter` or `setWidget(..., placement:"belowEditor")`; `setStatus(key,text)` | No | No | `FooterComponent` + `FooterDataProvider` |
| Status bar: context remaining | Yes — `ctx.getContextUsage()` (`{tokens, contextWindow, percent}`) | No | No | `ExtensionContext.getContextUsage()` |
| Status bar: provider usage limits (5-hour + longer-term) | **No** — `Usage` has cost/tokens only, no time-windowed remaining limits | **Yes** — new extension-point or core metadata to expose provider rate-limit remaining | Likely core change or extension-side tracking | `packages/coding-agent/src/core/usage-totals.ts`; `Usage` type in `packages/ai` |
| Path protection (granted folders, ON by default) | Yes — `tool_call` hook + `trust-manager.ts`/`protected-paths.ts` example | No (Bisque "granted folders" is new extension state) | No | `packages/coding-agent/src/core/trust-manager.ts` |
| Permission gate (manual approve, OFF auto-confirm by default) | Yes — `tool_call` hook returns `{block:true, reason}` | No | No | `permission-gate.ts` pattern; `agent-session.ts:_beforeToolCall` |
| Local Decision Model Auto-Confirm hook | Yes — `tool_call` hook (existing) | No for hook; **new local model runner** for weights | No | Decision Model = local weights (Liquid AI d1 adapter), stored under `~/.bisque/models/` |
| Input/tool-output screening (Llama Prompt Guard) | Yes — `input`/`context` (input), `tool_result` (output) hooks | No for hook; **new local classifier** for weights | No | Prompt Guard = local weights; stored under `~/.bisque/models/` |
| Strict opt-in for local models (never auto-download) | No existing model downloader | **Yes** — new slash-menu installer + storage convention | No | New extension; `/safety` slash menu |
| Slash-menu model installer + on/off toggles | Yes — `pi.registerCommand` for `/safety` | No for command; installer logic is new | No | New Bisque extension |
| Build-flagged SSH tool routing | Yes — `ssh.ts` example works | No for code; **build flag** to strip from release | No | Separate `packages/bisque-ssh/` or build-define; excluded from release builds |

### Privilege-boundary enforcement (no self-escalation)
Agent-callable config tools (registered via `pi.registerTool` with `exposure: "direct"`) must refuse to: enable Auto-approve, weaken classifiers, grant folder access, or trigger model downloads. Enforcement: each Bisque config tool checks `ctx.isProjectTrusted()` / a new "restricted" settings list and, for restricted changes, returns a message directing the user to the slash command (via the Bisque guide tool pattern) rather than mutating state. Core `SettingsManager` already refuses project-settings writes when `!projectTrusted` (`assertProjectTrustedForWrite`, `settings-manager.ts`).

---

## 4. Proposed layout & build scheme

### Directory/package layout (inside the fork, isolated from upstream `pi`)

```
packages/
  coding-agent/          # upstream pi (kept as-is; Bisque does not modify core)
  agent/                 # upstream pi-agent-core (kept as-is)
  ai/                    # upstream pi-ai (kept as-is)
  ...
  bisque/                # NEW — Bisque shell + extensions (workspace member)
    src/
      index.ts           # Bisque entry: loads pi-coding-agent + Bisque extensions
      shell.ts           # Bisque TUI wrapper: Goal bubble + Status bar + plain-language prompts
      extensions/
        goal.ts          # Goal bubble widget + turn-end goal verification
        status.ts        # Status bar (confirmation method, context remaining, usage limits)
        safety.ts        # /safety slash menu: model status, opt-in download, toggles
        permission.ts    # Permission gate + Decision Model Auto-Confirm hook
        prompt-guard.ts  # Llama Prompt Guard input/output screening hook
        paths.ts         # Granted-folders path protection
        config-tools.ts  # Safe agent-callable config tools + Bisque guide tool
        commands.ts      # Bisque slash commands (/goal, /safety, /folders, /mode, ...)
      models/
        runner.ts        # Local model inference runner (Decision Model + Prompt Guard)
        storage.ts       # Model weight storage under ~/.bisque/models/, manifest (URL, SHA-256, size)
    package.json
  bisque-ssh/            # NEW — SSH remote-execution extension (build-flagged, test-only)
    src/
      ssh.ts             # adapted from packages/coding-agent/examples/extensions/ssh.ts
    package.json         # excluded from release builds
```

### Local model runner / storage convention
- Weights stored at `<agentDir>/bisque/models/` (e.g. `~/.bisque/models/`) — never downloaded automatically.
- Versioned manifest JSON: `{name, version, url, sha256, sizeBytes, installedAt, enabled}`.
- `packages/bisque/src/models/runner.ts` — thin local inference wrapper over **ONNX Runtime via `@xenova/transformers`** (most portable for a Node/TypeScript CLI: no native compilation steps, works cross-platform on macOS/Linux/Windows, runs Liquid AI d1-2B and Llama Prompt Guard after ONNX conversion). Interface: `classify(prompt) => {allow: boolean, probability: number}` for Decision Model and Prompt Guard.
- `/safety` slash menu: view status of each model, explicitly confirm download/install, toggle on/off. Off by default.

### Build flag scheme (strip SSH from production) — DECIDED
- `packages/bisque-ssh/` is a separate workspace package, **not** included in the root `npm run build` sequence (root `package.json` build script lists packages in order; `bisque-ssh` omitted).
- SSH code is reachable only via a dedicated dev/test entrypoint (e.g. `bisque --ssh` or `npm run bisque:ssh`) that imports `packages/bisque-ssh`.
- Release/CI builds never bundle `bisque-ssh`; nothing SSH-related is importable from production artifacts.
- Rationale: separate package is the most portable option — no build-time defines, no esbuild configuration changes, guaranteed exclusion from release artifacts by construction. esbuild `--define` dead-code elimination was considered but rejected as it requires build config changes and leaves SSH code transitively importable.

### Build/test tooling (no new tooling)
- Reuse root `npm run build`, `npm run check` (biome + tsc), `./test.sh`.
- Bisque package added to root workspaces so `tsc --noEmit` covers it.
- Tests: vitest (already configured per package, e.g. `packages/coding-agent/vitest.config.ts`); Bisque tests under `packages/bisque/test/` using the faux provider (per AGENTS.md: `packages/coding-agent/test/suite/` harness + faux provider; no real APIs/keys/tokens).

---

## 5. First vertical slice (Milestone 1.1) — IMPLEMENTED

**Status:** All components implemented in `packages/bisque/` and `packages/bisque-ssh/`. No upstream `pi` packages were modified.

**Files created:**

| File | Purpose |
|---|---|
| `packages/bisque/package.json` | Workspace package manifest (depends on pi-coding-agent, pi-agent-core, pi-ai, @xenova/transformers) |
| `packages/bisque/tsconfig.json` | TypeScript config |
| `packages/bisque/src/index.ts` | Entry point: calls `main()` from pi-coding-agent with Bisque extension factories |
| `packages/bisque/src/storage.ts` | JSON file storage under `<agentDir>/bisque/` |
| `packages/bisque/src/models/runner.ts` | ONNX Runtime model runner stub (Decision Model + Prompt Guard) |
| `packages/bisque/src/models/storage.ts` | Model weight storage convention under `~/.bisque/models/` |
| `packages/bisque/src/extensions/index.ts` | Extension registry with load order |
| `packages/bisque/src/extensions/paths.ts` | Granted-folder path protection (ON by default) |
| `packages/bisque/src/extensions/permission.ts` | Permission gate: manual approve default, Auto-Confirm off |
| `packages/bisque/src/extensions/goal.ts` | Goal bubble above input bar + turn-end goal-completion review |
| `packages/bisque/src/extensions/status.ts` | Status bar below input bar: confirm method, context remaining, usage |
| `packages/bisque/src/extensions/safety.ts` | `/safety` slash menu: model status, opt-in install, enable/disable toggles |
| `packages/bisque/src/extensions/config-tools.ts` | `bisque_get_setting`, `bisque_set_setting`, `bisque_guide` agent tools |
| `packages/bisque/src/extensions/commands.ts` | `/goal`, `/mode`, `/folders`, `/safety` slash commands |
| `packages/bisque-ssh/package.json` | SSH extension package (excluded from release builds) |
| `packages/bisque-ssh/src/ssh.ts` | SSH remote-execution extension (test mode only) |
| `packages/bisque-ssh/tsconfig.json` | TypeScript config |
| `.env.example` | BYOK API key placeholders |

**Wired in this slice:**
- Bisque shell package (`packages/bisque`) with Goal bubble + Status bar extensions.
- Slash commands: `/goal`, `/mode` (Read/Manual approve/Auto-approve), `/folders`, `/safety`.
- Bisque guide tool (`bisque_guide`): for restricted actions, returns instructions telling the user the exact slash command to run.
- Local models OFF by default; no weights downloaded; explicit `/safety install` opt-in required.
- Path protection: granted folders only, current working directory granted on first run.
- Permission gate: manual confirm on write/delete/edit/bash; Auto-Confirm requires Decision Model install + enable.
- Build-flagged SSH: `packages/bisque-ssh/` omitted from root `npm run build` script.

**Remaining before first release:**
1. Add `packages/bisque` to root `npm run build` script (currently `packages/*` workspace glob installs it but build script doesn't build it).
2. Add vitest test for Goal bubble rendering + Status bar (confirmation method + context remaining).
3. Run `npm run check` (biome + tsc) once dependencies are installed.
4. Wire local usage tracking for the "API provider usage remaining" 5-hour + longer-term windows (currently placeholder).

---

## 6. Open questions (resolved)

1. **Provider usage limits — RESOLVED:** `pi-ai`'s `Usage` type carries `cost`/`tokens` but no time-windowed remaining allowance. Providers sometimes expose usage in their API response metadata, sometimes they don't (user-confirmed). **Decision:** Bisque tracks usage locally against self-defined, configurable limits (e.g. a 5-hour window + a weekly/monthly window) rather than relying on provider metadata. The Status bar shows locally tracked remaining usage; when a provider reports remaining allowance, it can augment the display.

2. **Build system for the SSH flag — RESOLVED:** Separate workspace package `packages/bisque-ssh/` omitted from the root `npm run build` sequence. Most portable — no build-time defines or esbuild config changes; SSH is guaranteed excluded from release artifacts by construction. (See section 4.)

3. **Decision Model / Prompt Guard runtime — RESOLVED:** ONNX Runtime via `@xenova/transformers`. Most portable for a Node/TypeScript CLI — no native compilation steps, works cross-platform (macOS/Linux/Windows), runs both Liquid AI d1-2B and Llama Prompt Guard after ONNX conversion. (See section 4.)

4. **SSH hook timing — RESOLVED:** `tool_call` hooks run on the host before the remote tool executes, since `pi.registerTool` wrappers intercept on the host. Bisque's SSH mode applies the same path-policy and permission/Auto-Confirm rules to remote paths via these host-side hooks.

5. **Widget above/below editor stability — OPEN:** `setWidget(key, content, options)` exists in `ExtensionUIContext` and `interactive-mode.ts` mounts `widgetContainerAbove`/`widgetContainerBelow`. Rendering details (component factory vs string array) to verify during implementation of the Goal bubble.

6. **`.env.example` — RESOLVED:** Add `.env.example` at repo root with BYOK API key placeholders (`ANTHROPIC_API_KEY=`, `OPENAI_API_KEY=`, `GOOGLE_API_KEY=`, etc.). Keys should also be addable via the `/login` tool. Bisque should support Radius (already supported in this fork version via `packages/coding-agent/src/core/radius.ts`).

---

## 7. Assumptions (stated explicitly)

- `pi-agent-core` and `pi-ai` are used as-is; Bisque features are built via extensions, skills, and prompt templates. No core changes in Milestone 1 except possibly exposing provider usage-limit metadata (resolved: Bisque tracks usage locally instead).
- Bisque code lives in new `packages/bisque/` and `packages/bisque-ssh/` workspaces; upstream `packages/coding-agent/` is not modified.
- Build/test/lint: reuse `npm run build`, `npm run check`, `./test.sh`; no new tooling.
- No secrets committed; API keys via environment variables + `.env.example` (to be added at repo root). Keys are also addable via the `/login` tool.
- Local model weights (Decision Model, Prompt Guard) are opt-in, downloaded only via `/safety` after explicit user confirmation, stored under `~/.bisque/models/`. Runtime: ONNX Runtime via `@xenova/transformers`.
- SSH mode is test-only, in separate `packages/bisque-ssh/` workspace omitted from release builds.
- Radius is supported by this fork version (via `packages/coding-agent/src/core/radius.ts`); Bisque should surface it as a provider option.
