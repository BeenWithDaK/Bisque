// SSH remote-execution extension for Bisque — TEST MODE ONLY.
// Build-flagged and EXCLUDED from release builds; nothing in packages/bisque imports this package.
//
// Architecture: host (Bisque + agent loop + safety models) -> ssh -> dest (file and command tools)
// - Model API calls, API keys, path-policy checks, Auto-Confirm decisions, and Prompt Guard stay on the host.
// - Only tool execution (read, write, edit, bash, and user ! commands) runs on dest.
// - Host-side tool_call hooks (paths.ts, permission.ts) intercept BEFORE remote tool execution.

import { spawn } from "node:child_process";
import { posix, relative, resolve, sep } from "node:path";
import {
	type BashOperations,
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type EditOperations,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ReadOperations,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";
import { readJson, writeJson } from "../../bisque/src/storage.ts";

const SSH_CONFIG_FILE = "ssh-config.json";

export interface SshConfig {
	host: string;
	user: string;
	remoteCwd?: string;
	port?: number;
	keyPath?: string;
	enabled: boolean;
}

export interface ResolvedSshSession {
	remote: string;
	remoteCwd: string;
	sshArgs: string[];
}

export interface SshStreamOptions {
	onData: (chunk: Buffer) => void;
	signal?: AbortSignal;
	timeout?: number;
}

export interface SshTransport {
	execBuffer(sshArgs: string[], command: string): Promise<Buffer>;
	execStream(sshArgs: string[], command: string, options: SshStreamOptions): Promise<{ exitCode: number | null }>;
}

const DEFAULT_CONFIG: SshConfig = { host: "", user: "", port: 22, enabled: false };

export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildSshBaseArgs(config: Pick<SshConfig, "host" | "user" | "port" | "keyPath">): string[] {
	const args: string[] = [];
	if (config.port && config.port !== 22) args.push("-p", String(config.port));
	if (config.keyPath) args.push("-i", config.keyPath);
	const target = config.user ? `${config.user}@${config.host}` : config.host;
	args.push(target);
	return args;
}

export function parseSshSpec(spec: string): { user: string; host: string; remoteCwd?: string } | null {
	const trimmed = spec.trim();
	if (!trimmed) return null;

	const colonIdx = trimmed.indexOf(":");
	const endpoint = colonIdx === -1 ? trimmed : trimmed.slice(0, colonIdx);
	const remoteCwd = colonIdx === -1 ? undefined : trimmed.slice(colonIdx + 1).trim();
	if (!endpoint) return null;

	const atIdx = endpoint.indexOf("@");
	const user = atIdx === -1 ? "" : endpoint.slice(0, atIdx);
	const host = atIdx === -1 ? endpoint : endpoint.slice(atIdx + 1);
	if (!host) return null;

	return {
		user,
		host,
		...(remoteCwd ? { remoteCwd } : {}),
	};
}

export function mapLocalToRemotePath(targetPath: string, localCwd: string, remoteCwd: string): string {
	const resolvedLocal = resolve(localCwd);
	const resolvedTarget = resolve(localCwd, targetPath);
	const rel = relative(resolvedLocal, resolvedTarget);
	if (rel === "") return remoteCwd;
	if (!rel.startsWith("..")) {
		return posix.join(remoteCwd, rel.split(sep).join("/"));
	}
	return targetPath;
}

const defaultTransport: SshTransport = {
	execBuffer(sshArgs: string[], command: string): Promise<Buffer> {
		return new Promise((resolvePromise, rejectPromise) => {
			const child = spawn("ssh", [...sshArgs, command], { stdio: ["ignore", "pipe", "pipe"] });
			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
			child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
			child.on("error", rejectPromise);
			child.on("close", (code) => {
				if (code !== 0) {
					rejectPromise(new Error(`SSH failed (${code}): ${Buffer.concat(stderrChunks).toString("utf-8")}`));
				} else {
					resolvePromise(Buffer.concat(stdoutChunks));
				}
			});
		});
	},
	execStream(sshArgs: string[], command: string, options: SshStreamOptions): Promise<{ exitCode: number | null }> {
		return new Promise((resolvePromise, rejectPromise) => {
			const child = spawn("ssh", [...sshArgs, command], { stdio: ["ignore", "pipe", "pipe"] });
			let timedOut = false;
			const timer = options.timeout
				? setTimeout(() => {
						timedOut = true;
						child.kill();
					}, options.timeout * 1000)
				: undefined;

			child.stdout.on("data", options.onData);
			child.stderr.on("data", options.onData);
			child.on("error", (err) => {
				if (timer) clearTimeout(timer);
				rejectPromise(err);
			});

			const onAbort = () => child.kill();
			options.signal?.addEventListener("abort", onAbort, { once: true });

			child.on("close", (code) => {
				if (timer) clearTimeout(timer);
				options.signal?.removeEventListener("abort", onAbort);
				if (options.signal?.aborted) {
					rejectPromise(new Error("aborted"));
				} else if (timedOut) {
					rejectPromise(new Error(`timeout:${options.timeout}`));
				} else {
					resolvePromise({ exitCode: code });
				}
			});
		});
	},
};

let transport: SshTransport = defaultTransport;
let activeConfig: SshConfig = { ...DEFAULT_CONFIG };
let resolvedSession: ResolvedSshSession | null = null;

export function setSshTransport(next: SshTransport | null): void {
	transport = next ?? defaultTransport;
}

export function getSshConfig(): SshConfig {
	return { ...activeConfig };
}

export function isSshEnabled(): boolean {
	return resolvedSession !== null;
}

function createRemoteReadOps(ssh: ResolvedSshSession, localCwd: string): ReadOperations {
	return {
		readFile: (p) =>
			transport.execBuffer(ssh.sshArgs, `cat -- ${shellQuote(mapLocalToRemotePath(p, localCwd, ssh.remoteCwd))}`),
		access: (p) =>
			transport
				.execBuffer(ssh.sshArgs, `test -r ${shellQuote(mapLocalToRemotePath(p, localCwd, ssh.remoteCwd))}`)
				.then(() => undefined),
		detectImageMimeType: async (p) => {
			try {
				const remotePath = mapLocalToRemotePath(p, localCwd, ssh.remoteCwd);
				const out = (await transport.execBuffer(ssh.sshArgs, `file --mime-type -b -- ${shellQuote(remotePath)}`))
					.toString("utf-8")
					.trim();
				return ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(out) ? out : null;
			} catch {
				return null;
			}
		},
	};
}

function createRemoteWriteOps(ssh: ResolvedSshSession, localCwd: string): WriteOperations {
	return {
		writeFile: async (p, content) => {
			const remotePath = mapLocalToRemotePath(p, localCwd, ssh.remoteCwd);
			const encoded = Buffer.from(content, "utf-8").toString("base64");
			await transport.execBuffer(
				ssh.sshArgs,
				`printf '%s' ${shellQuote(encoded)} | base64 -d > ${shellQuote(remotePath)}`,
			);
		},
		mkdir: (dir) =>
			transport
				.execBuffer(ssh.sshArgs, `mkdir -p -- ${shellQuote(mapLocalToRemotePath(dir, localCwd, ssh.remoteCwd))}`)
				.then(() => undefined),
	};
}

function createRemoteEditOps(ssh: ResolvedSshSession, localCwd: string): EditOperations {
	const readOps = createRemoteReadOps(ssh, localCwd);
	const writeOps = createRemoteWriteOps(ssh, localCwd);
	return {
		readFile: readOps.readFile,
		access: readOps.access,
		writeFile: writeOps.writeFile,
	};
}

function createRemoteBashOps(ssh: ResolvedSshSession, localCwd: string): BashOperations {
	return {
		exec: (command, cwd, opts) => {
			const remoteDir = mapLocalToRemotePath(cwd, localCwd, ssh.remoteCwd);
			const wrapped = `cd -- ${shellQuote(remoteDir)} && ${command}`;
			return transport.execStream(ssh.sshArgs, wrapped, {
				onData: opts.onData,
				...(opts.signal ? { signal: opts.signal } : {}),
				...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
			});
		},
	};
}

async function resolveSessionFromConfig(config: SshConfig): Promise<ResolvedSshSession | null> {
	if (!config.enabled || !config.host) return null;
	const sshArgs = buildSshBaseArgs(config);
	const remoteLabel = config.user ? `${config.user}@${config.host}` : config.host;
	const remoteCwd = config.remoteCwd || (await transport.execBuffer(sshArgs, "pwd")).toString("utf-8").trim();
	return {
		remote: remoteLabel,
		remoteCwd,
		sshArgs,
	};
}

function updateSshStatus(ctx: ExtensionContext): void {
	if (resolvedSession) {
		ctx.ui.setStatus("ssh", `SSH: ${resolvedSession.remote}:${resolvedSession.remoteCwd}`);
	} else {
		ctx.ui.setStatus("ssh", undefined);
	}
}

export function sshExtension(pi: ExtensionAPI): void {
	pi.registerFlag("ssh", { description: "SSH remote (test mode only): user@host or user@host:/path", type: "string" });

	const fallbackCwd = process.cwd();
	const localRead = createReadToolDefinition(fallbackCwd);
	const localWrite = createWriteToolDefinition(fallbackCwd);
	const localEdit = createEditToolDefinition(fallbackCwd);
	const localBash = createBashToolDefinition(fallbackCwd);

	pi.registerTool({
		...localRead,
		async execute(id, params, signal, onUpdate, ctx) {
			const cwd = ctx.cwd || fallbackCwd;
			const tool = resolvedSession
				? createReadToolDefinition(cwd, { operations: createRemoteReadOps(resolvedSession, cwd) })
				: createReadToolDefinition(cwd);
			return tool.execute(id, params, signal, onUpdate, ctx);
		},
	});

	pi.registerTool({
		...localWrite,
		async execute(id, params, signal, onUpdate, ctx) {
			const cwd = ctx.cwd || fallbackCwd;
			const tool = resolvedSession
				? createWriteToolDefinition(cwd, { operations: createRemoteWriteOps(resolvedSession, cwd) })
				: createWriteToolDefinition(cwd);
			return tool.execute(id, params, signal, onUpdate, ctx);
		},
	});

	pi.registerTool({
		...localEdit,
		async execute(id, params, signal, onUpdate, ctx) {
			const cwd = ctx.cwd || fallbackCwd;
			const tool = resolvedSession
				? createEditToolDefinition(cwd, { operations: createRemoteEditOps(resolvedSession, cwd) })
				: createEditToolDefinition(cwd);
			return tool.execute(id, params, signal, onUpdate, ctx);
		},
	});

	pi.registerTool({
		...localBash,
		async execute(id, params, signal, onUpdate, ctx) {
			const cwd = ctx.cwd || fallbackCwd;
			const tool = resolvedSession
				? createBashToolDefinition(cwd, { operations: createRemoteBashOps(resolvedSession, cwd) })
				: createBashToolDefinition(cwd);
			return tool.execute(id, params, signal, onUpdate, ctx);
		},
	});

	pi.registerCommand("ssh", {
		description: "SSH remote execution (test mode only): /ssh <status|connect user@host[:/path]|disconnect>",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "status", label: "status", description: "Show SSH test-mode status" },
				{ value: "connect ", label: "connect <user@host[:/path]>", description: "Connect SSH remote tool routing" },
				{ value: "disconnect", label: "disconnect", description: "Disable SSH remote tool routing" },
			];
			const needle = prefix.trim().toLowerCase();
			const filtered = needle ? items.filter((item) => item.value.startsWith(needle)) : items;
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const parts = args.trim().split(/\s+/);
			const action = parts[0];
			const rest = parts.slice(1).join(" ");

			if (!action || action === "status") {
				if (resolvedSession) {
					ctx.ui.notify(`SSH test mode: enabled — ${resolvedSession.remote}:${resolvedSession.remoteCwd}`, "info");
				} else {
					ctx.ui.notify("SSH test mode: disabled", "info");
				}
				return;
			}

			if (action === "connect") {
				const parsed = rest ? parseSshSpec(rest) : null;
				if (parsed) {
					activeConfig = {
						...activeConfig,
						user: parsed.user,
						host: parsed.host,
						...(parsed.remoteCwd ? { remoteCwd: parsed.remoteCwd } : {}),
						enabled: true,
					};
				} else if (activeConfig.host) {
					activeConfig = { ...activeConfig, enabled: true };
				} else {
					ctx.ui.notify("Usage: /ssh connect <user@host[:/remote/path]>", "error");
					return;
				}

				try {
					resolvedSession = await resolveSessionFromConfig(activeConfig);
					writeJson(SSH_CONFIG_FILE, activeConfig);
					updateSshStatus(ctx);
					if (resolvedSession) {
						ctx.ui.notify(
							`SSH test mode connected: ${resolvedSession.remote}:${resolvedSession.remoteCwd}`,
							"warning",
						);
					}
				} catch (err) {
					activeConfig.enabled = false;
					resolvedSession = null;
					updateSshStatus(ctx);
					ctx.ui.notify(`SSH connect failed: ${err instanceof Error ? err.message : String(err)}`, "error");
				}
				return;
			}

			if (action === "disconnect") {
				activeConfig = { ...activeConfig, enabled: false };
				resolvedSession = null;
				writeJson(SSH_CONFIG_FILE, activeConfig);
				updateSshStatus(ctx);
				ctx.ui.notify("SSH test mode disabled.", "info");
				return;
			}

			ctx.ui.notify("Usage: /ssh <status|connect <user@host[:/path]>|disconnect>", "error");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		activeConfig = readJson<SshConfig>(SSH_CONFIG_FILE, { ...DEFAULT_CONFIG });
		const flagVal = pi.getFlag("ssh");
		if (typeof flagVal === "string" && flagVal.trim()) {
			const parsed = parseSshSpec(flagVal);
			if (parsed) {
				activeConfig = {
					...activeConfig,
					user: parsed.user,
					host: parsed.host,
					...(parsed.remoteCwd ? { remoteCwd: parsed.remoteCwd } : {}),
					enabled: true,
				};
			}
		}

		try {
			resolvedSession = await resolveSessionFromConfig(activeConfig);
			updateSshStatus(ctx);
			if (resolvedSession) {
				ctx.ui.notify(`SSH test mode active: ${resolvedSession.remote}:${resolvedSession.remoteCwd}`, "warning");
			}
		} catch (err) {
			resolvedSession = null;
			updateSshStatus(ctx);
			ctx.ui.notify(`SSH startup failed: ${err instanceof Error ? err.message : String(err)}`, "error");
		}
	});

	pi.on("user_bash", (event) => {
		if (!resolvedSession) return undefined;
		return { operations: createRemoteBashOps(resolvedSession, event.cwd) };
	});

	pi.on("before_agent_start", async (event) => {
		if (!resolvedSession) return undefined;
		event.systemPromptOptions.sections.bisque_ssh = `Remote execution active via SSH: ${resolvedSession.remote}:${resolvedSession.remoteCwd} (tool operations run on the remote host).`;
		return undefined;
	});
}

export default sshExtension;
