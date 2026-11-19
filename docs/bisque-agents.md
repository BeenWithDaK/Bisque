# Bisque AGENTS.md

Bisque is a plain-language coworker/personal-assistant CLI built as a fork of `earendil-works/pi` at `/Users/benkraft/Documents/Bisque`. All Bisque features are implemented via extensions, skills, and prompt templates in `packages/bisque/` and `packages/bisque-ssh/` without modifying upstream `pi` packages.

## Production Implementation State (Complete)

### Architecture & Modules (`packages/bisque/`)
| File | Purpose |
|---|---|
| `packages/bisque/package.json` | Manifest (`bin: { bisque: "./dist/cli.js" }`, exports, build & test scripts) |
| `packages/bisque/tsconfig.build.json` | Production TypeScript build config emitting `dist/` (`.js`, `.d.ts`, `.map`) |
| `packages/bisque/vitest.config.ts` | Vitest configuration aliasing workspace source packages |
| `packages/bisque/src/cli.ts` | Executable CLI entrypoint (`#!/usr/bin/env node`) |
| `packages/bisque/src/index.ts` | Side-effect-free public library surface + `runBisqueCli()` |
| `packages/bisque/src/env.ts` | Non-overriding `.env` loader + `GOOGLE_API_KEY` → `GEMINI_API_KEY` normalization |
| `packages/bisque/src/storage.ts` | Atomic JSON state persistence under `<agentDir>/bisque/` |
| `packages/bisque/src/shell.ts` | Coworker persona prompt section, custom TUI startup header, terminal title, and `resources_discover` |
| `packages/bisque/src/models/storage.ts` | `~/.bisque/models/` manifest, SHA-256 verification, and atomic opt-in weight installer |
| `packages/bisque/src/models/runner.ts` | Lazy ONNX Runtime (`@xenova/transformers` with WASM fallback and `allowRemoteModels = false`) for Decision Model & Prompt Guard |
| `packages/bisque/src/extensions/index.ts` | Ordered extension registry (`prompt-guard`, `paths`, `permission`, `shell`, `goal`, `status`, `safety`, `config-tools`, `commands`) |
| `packages/bisque/src/extensions/prompt-guard.ts` | Llama Prompt Guard screening across `input`, `tool_result`, and `context` |
| `packages/bisque/src/extensions/paths.ts` | Granted-folder path protection (ON by default; canonical path containment) |
| `packages/bisque/src/extensions/permission.ts` | Permission gate (`Read` / `Manual approve` / `Auto-approve`) + Decision Model Auto-Confirm hook |
| `packages/bisque/src/extensions/goal.ts` | Goal bubble (`aboveEditor`), `bisque_complete_goal` tool, `turn_end` review, and pre-stop `agent_before_settle` verification |
| `packages/bisque/src/extensions/status.ts` | Status bar (`belowEditor`): confirm mode, context remaining, 5h/7d local usage ledger + provider rate-limit header augmentation |
| `packages/bisque/src/extensions/safety.ts` | `/safety` slash menu (`status`, `menu`, `install`, `uninstall`, `enable`, `disable`, `toggle`) |
| `packages/bisque/src/extensions/config-tools.ts` | `bisque_get_setting`, `bisque_set_setting`, `bisque_guide` with strict privilege-escalation refusal |
| `packages/bisque/src/extensions/commands.ts` | Unified `/goal`, `/mode`, `/folders`, `/safety` commands with tab-completions |
| `packages/bisque/skills/bisque-coworker/SKILL.md` | Built-in Bisque coworker workflow skill |
| `packages/bisque/prompts/plan.md`, `summarize.md` | Built-in `/plan` and `/summarize` prompt templates |
| `packages/bisque/test/*.test.ts` | Vitest suites covering vertical slice, pre-stop goal check, `.env`, SHA-256 ONNX installer, Prompt Guard, Auto-Confirm, and SSH build isolation |

### Build-Flagged SSH Package (`packages/bisque-ssh/`)
- `packages/bisque-ssh/src/ssh.ts` — Remote `read`/`write`/`edit`/`bash` and `!` (`user_bash`) routing over SSH via pluggable `SshTransport`; host-side `paths` and `permission` hooks enforce safety before remote execution.
- `packages/bisque-ssh/src/cli.ts` — Dedicated dev/test CLI entrypoint (`npm run bisque:ssh`). Excluded from root `npm run build` and absent from `packages/bisque/dist/`.
- `packages/bisque-ssh/test/ssh.test.ts` — Vitest suite verifying remote tool routing and host safety gate ordering.

### Verification Commands
- `npm run check` — Biome, pinned/runtime deps, relative imports, entry-point budgets, install-lock, root + examples `tsc --noEmit`, browser smoke
- `cd packages/bisque && npm run build` — compiles `packages/bisque/dist/` and marks `dist/cli.js` executable
- `cd packages/bisque && node ../../node_modules/vitest/dist/cli.js --run` — runs all Bisque production tests
- `cd packages/bisque-ssh && node ../../node_modules/vitest/dist/cli.js --run` — runs SSH extension tests
