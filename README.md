<p align="center">
  <a href="https://pi.dev">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@earendil-works/pi-coding-agent"><img alt="npm" src="https://img.shields.io/npm/v/@earendil-works/pi-coding-agent?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

# Bisque

**Bisque is a coworker and personal assistant for real-life work**—built for everybody, not just developers.

Bisque is a CLI agent for everyday, non-coding tasks: organizing files, summarizing documents, drafting letters, making spreadsheets, managing personal projects, and handling office work. Rather than disappearing into a black box, Bisque works *with* you—communicative, collaborative, and transparent.

## Design Priorities (in order)

1. **Human comfort & clarity first**
   - Plain, conversational language everywhere
   - Clean visual hierarchy, minimal noise by default
   - Nothing that assumes the user knows git, stack traces, or terminal conventions
   - **Everything is a slash command**: All settings, modes, granted folders, and safety toggles are accessible through `/` commands
   - **Conversational configuration with safe boundaries**: Everything accessible via slash commands that is safe for the agent to do so (and doesn't unlock any loopholes) is available to the Agent to configure for the user. If something isn't accessible, there should be a Bisque tool onboard so the agent can tell the user what to do to configure that.

2. **Collaborative partnership second**
   - Transparent plans before multi-file or hard-to-reverse actions
   - Proactive check-ins when something is unclear
   - Honest communication about capabilities, progress, and problems
   - The agent checks its active **Goal** before stopping its turn

3. **Intelligent execution third**
   - Capable, multi-step real-world work across documents, files, and data
   - Local safety models for autonomous operation (opt-in)

## Shell UI & Goal-Driven Turn Loop

### Goal Bubble (above the prompt bar)
- Renders a compact, fit-sized bubble directly above the prompt bar displaying the active **Goal** (the concrete outcome the agent should reach before stopping)
- **Pre-stop Goal Check**: Like a conscientious coworker, Bisque evaluates whether the active Goal has actually been completed before ending a turn. The model can still end its turn to ask questions, clarify, or disclaim problems.

### Status Bar (below the prompt bar)
- Renders a clean, single-line status bar directly below the prompt bar displaying:
  1. **Confirmation method**: Current active mode (`Read`, `Manual approve`, or `Auto-approve`)
  2. **Context remaining**: Remaining conversation/workspace memory in plain, easy-to-read terms
  3. **API provider usage remaining**: Remaining usage allowance from the active provider, with room to display **both a 5-hour and longer limit at once**, if applicable

## Core Behavior & Safety Model

### Confirm plans before big actions
Present a clear, plain-language plan before any multi-file or hard-to-reverse action, and wait for a yes.

### Path protection (ON by default)
Bisque only touches folders the user has explicitly granted access to.

### Permission gate with optional Auto-Confirm (OFF by default)
- By default, ask before writing, deleting, sending, or running commands
- When enabled, **Auto-Confirm** delegates routine permission checks to a local, custom fine-tuned **Decision Model** (Liquid AI d1-2B) that evaluates `{ active_goal, recent_context, granted_paths, tool_name, tool_args }` against a binary question: *"Is this action safe, non-destructive, and directly aligned with the user's active goal?"*
- Calibrated confidence thresholds: `p(allow) >= threshold` → auto-confirm; `p(allow) < threshold` → escalate to manual confirmation or hard block

### Prompt injection protection with Llama Prompt Guard (OFF by default)
- When enabled, screen untrusted external content (file contents, downloaded documents, tool outputs) through a local **Llama Prompt Guard** model
- Only content from outside the granted paths is screened

### Strict opt-in for local models
- Both the Decision Model and Llama Prompt Guard are **OFF by default**
- **Never** download or install model weights automatically on startup or first run
- Provide a slash menu (e.g., `/safety` or `/models`) where users can view status, explicitly confirm downloading/installing, and toggle each model on/off

### No self-escalation via agent config tools
- Agent-callable configuration tools must enforce strict privilege boundaries—the agent cannot silently enable `Auto-confirm`, disable path protection, or install local models

## Architecture

### Keep Pi's core intact
Use `pi-agent-core` and `pi-ai` as-is where possible. Build Bisque features via extensions, skills, and prompt templates where Pi supports them. Only modify core when there's no extension point, and document every core change.

### Plain-language shell
Replace or wrap Pi's developer-oriented TUI (`pi-tui` / coding-agent interface) with a warm, collaborative shell using plain-language prompts and output.

### BYOK (Bring Your Own Key)
Users supply their own model API keys on the host machine. Keys live only on the host.

## Test-Only Remote Execution (NOT for production)

We need a test mode where Bisque runs on a host and executes tools on a remote destination over SSH:

```
host (Bisque + agent loop + safety models) → ssh → dest (file and command tools)
```

**Rules:**
- Model API calls, API keys, path-policy checks, Auto-Confirm decisions, and Prompt Guard checks stay on the host. Only tool execution (file read/write, shell commands) goes to the destination.
- Path protection and permission/Auto-Confirm rules apply to remote paths identically to local paths.
- Undo snapshots are taken on the dest side before each change, and the undo command works in remote mode.
- Gate this mode behind a build flag or separate extension package excluded from release builds. Nothing SSH-related should be reachable in production builds.
- Start from Pi's SSH example (`packages/coding-agent/examples/extensions/ssh.ts`) and verify its actual behavior against the rules above.

## Packages

This monorepo contains the Pi CLI and its supporting libraries (upstream), plus Bisque-specific packages.

| Package | Description |
|---------|-------------|
| **[@earendil-works/chord](packages/chord)** | Object runtime for apps across processes: contracts, documents, a store, links, plugins with hot reload, HTTP, workers, web and terminal clients |
| **[@earendil-works/pi-telemetry](packages/telemetry)** | Vendor-neutral telemetry contracts, reference adapter, conformance tests, and typed schemas |
| **[@earendil-works/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@earendil-works/pi-durable](packages/durable)** | Durable conversation, task, and document runtime |
| **[@earendil-works/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@earendil-works/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI (upstream Pi) |
| **[@earendil-works/pi-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@earendil-works/pi-bisque](packages/bisque)** | **Bisque: collaborative CLI agent for everyday work** |
| **[@earendil-works/pi-bisque-decision-model](packages/bisque-decision-model)** | Local Decision Model (Liquid AI d1-2B fine-tune) for Auto-Confirm |
| **[@earendil-works/pi-bisque-prompt-guard](packages/bisque-prompt-guard)** | Llama Prompt Guard integration for prompt injection protection |

For Slack/chat automation and workflows see [earendil-works/pi-chat](https://github.com/earendil-works/pi-chat).

## Permissions & Containerization

Bisque does not include a built-in permission system for restricting filesystem, process, network, or credential access. By default, it runs with the permissions of the user and process that launched it.

If you need stronger boundaries, containerize or sandbox Bisque. See [packages/coding-agent/docs/containerization.md](packages/coding-agent/docs/containerization.md) for three patterns (adapted for Bisque):

- **Gondolin extension**: keep `bisque` and provider auth on the host while routing built-in tools and `!` commands into a local Linux micro-VM
- **Plain Docker**: run the whole `bisque` process in a local container for simple isolation
- **OpenShell**: run the whole `bisque` process in a policy-controlled sandbox

## Development

```bash
npm install --ignore-scripts  # Install all dependencies without running lifecycle scripts
npm run build         # Refresh model data, then build all packages
npm run build:offline # Rebuild using existing model data without network access
npm run check         # Lint, format, and type check
./test.sh             # Run tests (skips LLM-dependent tests without API keys)
./bisque-test.sh      # Run Bisque from sources (can be run from any directory)
```

### Using local packages outside the monorepo

Build every public package into one coherent local artifact set:

```bash
npm run pack:packages -- --out .artifacts/pi-packages
```

This refreshes model data before building `pi-ai`. To avoid network access when model data is already hydrated, pass `--offline-model-data`.

Then configure an external project to consume one package and resolve all of its Pi dependencies from the same artifact set:

```bash
node scripts/use-local-packages.mjs \
  --manifest .artifacts/pi-packages/manifest.json \
  --consumer ../my-project \
  --package @earendil-works/pi-bisque \
  --package @earendil-works/pi-agent-core
cd ../my-project
npm install --ignore-scripts
```

### Bisque-specific development

```bash
# Run Bisque from source
./bisque-test.sh

# Build with test-only SSH mode enabled
BISQUE_ENABLE_SSH=1 npm run build

# Run with local Decision Model (requires model weights)
BISQUE_DECISION_MODEL_PATH=./models/d1-2b ./bisque-test.sh
```

## Building standalone binaries from release source

GitHub releases include a versioned source archive covered by the release's `SHA256SUMS` file. Extract it and run the same build script used for the official standalone binaries:

```bash
VERSION="<release-version>"
tar -xzf "bisque-${VERSION}-source.tar.gz"
cd "bisque-${VERSION}"
./scripts/build-binaries.sh --offline-model-data --platform linux-x64 --out "$PWD/out"
```

The archive includes release model data and native prebuilds. `--offline-model-data` uses that model data without refreshing provider catalogs.

## Supply-chain hardening

We treat npm dependency changes as reviewed code changes.

- Direct external dependencies are pinned to exact versions. Internal workspace packages remain version-ranged.
- `.npmrc` sets `save-exact=true` and `min-release-age=2` to avoid same-day dependency releases during npm resolution.
- `package-lock.json` is the dependency ground truth. Pre-commit blocks accidental lockfile commits unless `PI_ALLOW_LOCKFILE_CHANGE=1` is set.
- `npm run check` verifies pinned direct deps, native TypeScript import compatibility, and the generated coding-agent install lock.
- The pi.dev installer installs from `packages/coding-agent/install-lock/`, generated from the root lockfile, to pin transitive deps. The npm package does not pin transitive deps.
- Local release smoke tests and npm publication use the same tarball packer; npm publishes the validated tarballs rather than repacking workspace directories.
- Local release installs, documented npm installs, and `bisque update --self` use `--ignore-scripts` where supported.
- CI installs with `npm ci --ignore-scripts`, and a scheduled GitHub workflow runs `npm audit --omit=dev` plus `npm audit signatures --omit=dev`.
- Install lock generation has an explicit allowlist for dependency lifecycle scripts; new lifecycle-script deps fail checks until reviewed.

## Share your OSS coding agent sessions

If you use Bisque or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## Bisque Roadmap

### Phase 0: Foundation & Exploration (Milestone 1 — Current)
*Explore the repo, audit existing examples, map extension points, propose layout and build scheme.*

- [ ] Inspect repo structure, `README`, and `packages/coding-agent` docs. Summarize packages, extension API (hooks, tool registration, lifecycle), how skills and prompt templates are loaded, and how the TUI is wired.
- [ ] Audit SSH example (`examples/extensions/ssh.ts`), permission-gate (`examples/extensions/permission-gate.ts`), protected-paths (`examples/extensions/protected-paths.ts`), and sandbox examples. Summarize how each works and whether it can be reused.
- [ ] Identify every extension point needed for Bisque:
  - Plain-language shell & coworker persona/prompting
  - Unified slash-command system, safe agent-callable configuration tools, onboard Bisque guide/help tool
  - Goal bubble (above prompt bar) and turn-end goal-completion verification
  - Status bar (below prompt bar): confirmation method, context remaining, API provider usage (5hr + longer limits)
  - Path protection
  - Permission gate + local Decision Model Auto-Confirm hook
  - Input/tool-output screening hook for local Llama Prompt Guard
  - Slash-menu model installer and on/off toggles
  - Build-flagged SSH tool routing
- [ ] Propose directory/package layout for Bisque inside the fork, a local model runner abstraction, and a build flag scheme for test-only SSH mode.
- [ ] Define first vertical slice: one minimal end-to-end local flow (e.g., setting a Goal to organize or summarize files in a granted folder, moving one file after confirmation, with undo).
- [ ] List open questions and anything ambiguous/unverified in the codebase.
- [ ] Output: `docs/bisque-plan.md` with findings (file paths, function names, line references).

### Phase 1: Core Shell & Safety Primitives
*Build the foundational Bisque shell and safety primitives locally.*

- [ ] Create Bisque package structure (`packages/bisque/`)
- [ ] Implement plain-language shell (replace/wrap pi-tui)
- [ ] Implement path protection (ON by default) — grant/deny folders via slash commands
- [ ] Implement permission gate with `Read` / `Manual approve` / `Auto-approve` modes
- [ ] Implement **Goal Bubble** UI component (above prompt bar)
- [ ] Implement **Status Bar** UI component (below prompt bar) with confirmation method, context remaining, API usage
- [ ] Implement unified slash-command system (all settings accessible via `/`)
- [ ] Implement basic undo snapshot mechanism (local filesystem snapshots before each change)
- [ ] **First vertical slice**: "Set a Goal to list files in a granted folder and move one file after confirmation" with undo — working end-to-end locally

### Phase 2: Collaborative Features & Configuration
*Make Bisque feel like a collaborative coworker.*

- [ ] Goal-driven turn loop with pre-stop goal-completion verification
- [ ] Conversational configuration via slash commands (everything is a slash command)
- [ ] Agent-callable configuration tools with privilege boundaries (no self-escalation)
- [ ] Onboard Bisque guide/help tool for inaccessible settings
- [ ] Coworker persona/prompting system (skills + prompt templates)
- [ ] Plan presentation before multi-file/hard-to-reverse actions

### Phase 3: Auto-Confirm & Decision Model Integration
*Local Decision Model for autonomous routine operations.*

- [ ] Define Decision Model input/output schema: `{ active_goal, recent_context, granted_paths, tool_name, tool_args }` → binary safety decision with calibrated probability
- [ ] Build training & evaluation datasets:
  - **Positive**: routine file organization, reading granted folders, creating/editing requested spreadsheets/notes/drafts aligned with active_goal
  - **Negative/hard-negative**: deleting unrequested files, recursive moves/deletes outside scope, shell commands with side effects (`curl \| sh`, credential harvesting, `rm -rf`), obfuscated commands, tool calls triggered by indirect prompt injections
- [ ] Fine-tune LiquidAI/d1-2B: lightweight adapter or fine-tune checkpoint optimizing for near-zero false-allow rates on harmful/off-goal actions
- [ ] Calibrate confidence thresholds: two-tier policy (`p(allow) >= threshold` → auto-confirm; `p(allow) < threshold` → escalate to manual/hard-block)
- [ ] Package for local offline inference: quantize and export weights compatible with llama.cpp / Ollama / local Transformers worker
- [ ] Publish versioned model manifest (URL, file size, SHA-256 checksum) for `/safety` slash menu downloader
- [ ] Integrate Decision Model hook into permission gate (Auto-Confirm mode)
- [ ] Slash menu (`/safety` or `/models`) for model status, download, install, toggle

### Phase 4: Prompt Injection Protection
*Screen untrusted content with Llama Prompt Guard.*

- [ ] Integrate Llama Prompt Guard for screening untrusted external content (file contents, downloaded documents, tool outputs)
- [ ] Hook into file reads, tool outputs, external documents
- [ ] Slash menu toggle for Prompt Guard
- [ ] Red-team regression suite for adversarial testing

### Phase 5: Test-Only SSH Remote Execution
*Remote tool execution for testing (excluded from production builds).*

- [ ] Adapt Pi's SSH example extension (`packages/coding-agent/examples/extensions/ssh.ts`)
- [ ] Implement build flag gating (`BISQUE_ENABLE_SSH=1` at compile time, excluded from release builds)
- [ ] Host runs Bisque + agent loop + safety models; Dest runs file/command tools only
- [ ] Path protection & permission rules apply to remote paths identically
- [ ] Undo snapshots on dest side before each change
- [ ] Verify no SSH code reachable in production builds

### Phase 6: Polish & Production Readiness
*Comprehensive slash coverage, usage tracking, performance, docs.*

- [ ] Comprehensive slash command coverage (all settings, modes, granted folders, safety toggles)
- [ ] Context remaining calculation and display
- [ ] API provider usage tracking (5-hour + longer limits, e.g., monthly quota)
- [ ] Performance optimization (<300ms Decision Model latency per check)
- [ ] Documentation and user guides
- [ ] Release packaging

## Open Questions

1. **Provider usage limits**: Which providers expose 5-hour vs longer usage limits? How to query remaining quota programmatically?
2. **TUI extension points**: Exact extension points for Goal Bubble (above prompt bar), Status Bar (below prompt bar), and unified slash-command system?
3. **Permission gate**: How does Pi's current permission gate work? Can it be extended or must it be replaced?
4. **Undo/snapshot mechanism**: Does Pi have an existing undo/snapshot mechanism, or must we build one?
5. **Skill/prompt template loading**: How to load coworker persona via skills/prompt templates?
6. **Build system for flagged features**: TypeScript compile-time flags vs runtime config for SSH mode exclusion?
7. **Local inference runtime**: llama.cpp vs Ollama vs Transformers.js for Decision Model and Prompt Guard?
8. **Model manifest hosting**: Where to host versioned model manifests (URL, size, SHA-256) for slash menu downloader?
9. **Context remaining calculation**: How to accurately compute remaining context window capacity in plain terms?
10. **Goal completion verification**: How to implement the pre-stop Goal check reliably without false positives/negatives?

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents). Longer term plans for Pi can also be found in [RFCs](https://rfc.earendil.com/keyword/pi).

## License

MIT

<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>