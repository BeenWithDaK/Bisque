# Bisque (`@earendil-works/bisque`)

Plain-language coworker and personal-assistant CLI built on `@earendil-works/pi-coding-agent`, `@earendil-works/pi-agent-core`, and `@earendil-works/pi-ai` without modifying upstream `pi` packages.

## Quick Start

1. Copy `.env.example` to `.env` at the repository root and set at least one provider API key (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` / `GOOGLE_API_KEY`, or `RADIUS_API_KEY`), or authenticate interactively with `/login`.
2. Build and launch Bisque:

```bash
cd packages/bisque && npm run build
node packages/bisque/dist/cli.js
```

## Slash Commands

- `/goal <task>` — Set the active Goal rendered above the prompt editor; run `/goal` (or `/goal clear`) to clear it. Bisque verifies goal completion before settling.
- `/mode [Read|Manual approve|Auto-approve]` — Set confirmation method (`Manual approve` by default). Running `/mode` with no arguments opens an interactive selector.
- `/folders [list|add <path>|remove <path>]` — View or modify granted folders. Only the launch working directory is granted on first run.
- `/safety [status|menu|install <model>|uninstall <model>|enable <model>|disable <model>|toggle <model>]` — Manage local ONNX safety models (`decision-model` and `prompt-guard`). Both are off by default and never auto-downloaded; weights are SHA-256 verified and stored under `~/.bisque/models/`.
- `/plan <task>` / `/summarize [target]` — Built-in plain-language prompt templates.
- `/login` — Configure provider credentials, including Radius.

## Agent Configuration Tools & Privilege Boundaries

- `bisque_get_setting` — Read active confirmation mode, goal, granted folders, safety model states, and usage limits.
- `bisque_set_setting` — Update non-restricted settings (`usageLimits.fiveHourTokens`, `usageLimits.weeklyTokens`). Restricted settings (`confirmMode`, `grantedFolders`, `localModels.*`) are rejected to prevent agent self-escalation.
- `bisque_guide` — Return the exact user slash command required for a restricted change.
- `bisque_complete_goal` — Mark the active Goal verified with a plain-language summary.

## Build-Flagged SSH Mode

SSH remote tool execution lives in the separate `@earendil-works/bisque-ssh` workspace (`packages/bisque-ssh/`), which is omitted from root release builds (`npm run build`). Production artifacts in `packages/bisque/dist/` never import or bundle SSH code.
