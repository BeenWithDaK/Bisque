Bisque production implementation is complete at `/Users/benkraft/Documents/Bisque`.

## What's implemented

1. **Production CLI & library (`packages/bisque/`)**:
   - Executable CLI entrypoint (`packages/bisque/src/cli.ts` -> `packages/bisque/dist/cli.js`) and side-effect-free library API (`packages/bisque/src/index.ts`).
   - `.env` loader (`packages/bisque/src/env.ts`) supporting BYOK (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`) and Radius (`RADIUS_API_KEY`, `PI_RADIUS_GATEWAY`) alongside `/login`.
   - Coworker shell (`packages/bisque/src/shell.ts`), custom TUI header, built-in `bisque-coworker` skill (`skills/bisque-coworker/SKILL.md`), and `/plan` + `/summarize` prompt templates (`prompts/`).

2. **Goal, Status, & Local Usage Tracking**:
   - Goal bubble (`aboveEditor`), `bisque_complete_goal` tool, `turn_end` review, and bounded pre-stop `agent_before_settle` goal verification (`packages/bisque/src/extensions/goal.ts`).
   - Status bar (`belowEditor`) displaying confirmation mode, context remaining, and locally tracked 5-hour / 7-day rolling token usage augmented by provider rate-limit headers (`packages/bisque/src/extensions/status.ts`).

3. **Safety, Local ONNX Models, & Privilege Boundaries**:
   - Granted-folder path protection ON by default with canonical path containment (`packages/bisque/src/extensions/paths.ts`).
   - Permission gate (`Read`, `Manual approve`, `Auto-approve`) with interactive `/mode` selector and Decision Model Auto-Confirm hook (`packages/bisque/src/extensions/permission.ts`).
   - SHA-256 verified opt-in model installer under `~/.bisque/models/` (`packages/bisque/src/models/storage.ts`) and lazy `@xenova/transformers` ONNX runner with WASM fallback and `allowRemoteModels = false` (`packages/bisque/src/models/runner.ts`).
   - Llama Prompt Guard screening across `input`, `tool_result`, and `context` (`packages/bisque/src/extensions/prompt-guard.ts`) and `/safety` slash menu (`packages/bisque/src/extensions/safety.ts`).
   - Agent config tools (`bisque_get_setting`, `bisque_set_setting`, `bisque_guide`) refusing self-escalation (`packages/bisque/src/extensions/config-tools.ts`).

4. **Build-Flagged SSH Isolation (`packages/bisque-ssh/`)**:
   - Full remote `read`/`write`/`edit`/`bash` and `user_bash` routing over `SshTransport` (`packages/bisque-ssh/src/ssh.ts`) and dev/test CLI (`packages/bisque-ssh/src/cli.ts`), omitted from release builds and verified absent from `packages/bisque/dist/`.
