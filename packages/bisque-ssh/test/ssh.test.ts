// Dev/test-only SSH remote execution extension tests.
// Verifies remote tool routing over mock SshTransport and proves host-side
// granted-folder path policy and permission gates run BEFORE remote execution.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemPrompt } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bisqueExtensions } from "../../bisque/src/extensions/index.ts";
import {
	createHarness,
	createTestUiContext,
	getToolResult,
	type Harness,
} from "../../coding-agent/test/suite/harness.ts";
import {
	buildSshBaseArgs,
	isSshEnabled,
	mapLocalToRemotePath,
	parseSshSpec,
	type SshTransport,
	setSshTransport,
	shellQuote,
	sshExtension,
} from "../src/ssh.ts";

describe("bisque-ssh remote tool routing and host safety gates", () => {
	const harnesses: Harness[] = [];
	const tempDirs: string[] = [];
	let agentDir = "";

	beforeEach(() => {
		agentDir = join(tmpdir(), `bisque-ssh-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(agentDir, { recursive: true });
		tempDirs.push(agentDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.BISQUE_MODELS_DIR = join(agentDir, "models");
	});

	afterEach(() => {
		setSshTransport(null);
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (tempDirs.length > 0) {
			const dir = tempDirs.pop();
			if (dir && existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
		delete process.env.PI_CODING_AGENT_DIR;
		delete process.env.BISQUE_MODELS_DIR;
	});

	it("parses SSH specs, quotes remote shell arguments safely, and maps paths", () => {
		expect(parseSshSpec("alice@prod.example.com:/srv/app")).toEqual({
			user: "alice",
			host: "prod.example.com",
			remoteCwd: "/srv/app",
		});
		expect(parseSshSpec("devbox")).toEqual({ user: "", host: "devbox" });
		expect(shellQuote("file with '$HOME' & spaces.txt")).toBe("'file with '\\''$HOME'\\'' & spaces.txt'");
		expect(buildSshBaseArgs({ user: "alice", host: "box", port: 2222, keyPath: "/tmp/id_ed25519" })).toEqual([
			"-p",
			"2222",
			"-i",
			"/tmp/id_ed25519",
			"alice@box",
		]);
		expect(mapLocalToRemotePath("subdir/notes.md", "/local/work", "/remote/work")).toBe(
			"/remote/work/subdir/notes.md",
		);
	});

	it("routes write, read, and bash over SSH while enforcing host path and permission gates first", async () => {
		const executedCommands: Array<{ args: string[]; command: string }> = [];
		const remoteFiles = new Map<string, Buffer>();

		const mockTransport: SshTransport = {
			execBuffer: async (sshArgs, command) => {
				executedCommands.push({ args: sshArgs, command });
				if (command === "pwd") return Buffer.from("/remote/workspace\n", "utf-8");
				if (command.startsWith("mkdir -p")) return Buffer.alloc(0);
				if (command.includes("| base64 -d >")) {
					const b64Match = /printf '%s' '([^']*)' \| base64 -d > '([^']*)'/.exec(command);
					if (b64Match?.[1] !== undefined && b64Match[2] !== undefined) {
						remoteFiles.set(b64Match[2], Buffer.from(b64Match[1], "base64"));
					}
					return Buffer.alloc(0);
				}
				if (command.startsWith("test -r ")) {
					const pathMatch = /test -r '([^']*)'/.exec(command);
					if (!pathMatch?.[1] || !remoteFiles.has(pathMatch[1])) {
						throw new Error("No such remote file");
					}
					return Buffer.alloc(0);
				}
				if (command.startsWith("file --mime-type")) {
					return Buffer.from("text/plain\n", "utf-8");
				}
				if (command.startsWith("cat -- ")) {
					const pathMatch = /cat -- '([^']*)'/.exec(command);
					return remoteFiles.get(pathMatch?.[1] ?? "") ?? Buffer.alloc(0);
				}
				return Buffer.alloc(0);
			},
			execStream: async (sshArgs, command, options) => {
				executedCommands.push({ args: sshArgs, command });
				options.onData(Buffer.from("remote-uname-linux\n", "utf-8"));
				return { exitCode: 0 };
			},
		};
		setSshTransport(mockTransport);

		let allowConfirm = true;
		const harness = await createHarness({
			models: [{ id: "faux-ssh", name: "Faux SSH", contextWindow: 200_000, maxTokens: 8_192 }],
			extensionFactories: [...bisqueExtensions, { name: "bisque-ssh", factory: sshExtension, builtin: true }],
		});
		harnesses.push(harness);

		await harness.session.bindExtensions({
			uiContext: createTestUiContext({ confirm: async () => allowConfirm }),
			mode: "tui",
		});

		expect(isSshEnabled()).toBe(false);
		await harness.session.prompt("/ssh connect dev@testbox:/remote/workspace");
		expect(isSshEnabled()).toBe(true);

		let systemPromptSeen = "";
		harness.setResponses([
			(context) => {
				systemPromptSeen = getCurrentSystemPrompt(context.messages) ?? "";
				return fauxAssistantMessage([
					fauxToolCall("write", { path: "remote-note.txt", content: "hello over ssh" }),
					fauxToolCall("bash", { command: "uname -a" }),
				]);
			},
			fauxAssistantMessage([fauxToolCall("read", { path: "remote-note.txt" })]),
			fauxAssistantMessage("Completed remote operations."),
		]);

		await harness.session.prompt("Write, run bash, and read remotely");

		expect(systemPromptSeen).toContain("Remote execution active via SSH: dev@testbox:/remote/workspace");
		expect(remoteFiles.get("/remote/workspace/remote-note.txt")?.toString("utf-8")).toBe("hello over ssh");
		expect(existsSync(join(harness.tempDir, "remote-note.txt"))).toBe(false); // Not written locally!
		expect(JSON.stringify(getToolResult(harness, "read").content)).toContain("hello over ssh");
		expect(JSON.stringify(getToolResult(harness, "bash").content)).toContain("remote-uname-linux");

		// Verify host-side path gate blocks ungranted path BEFORE any SSH command executes.
		const countBeforeBlockedPath = executedCommands.length;
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "/etc/unauthorized.txt", content: "nope" })]),
			fauxAssistantMessage("Blocked by host path gate."),
		]);
		await harness.session.prompt("Try writing to /etc/unauthorized.txt");
		expect(getToolResult(harness, "write").isError).toBe(true);
		expect(executedCommands.length).toBe(countBeforeBlockedPath);

		// Verify host-side Manual approve rejection blocks BEFORE any SSH command executes.
		allowConfirm = false;
		const countBeforeDecline = executedCommands.length;
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("bash", { command: "rm -rf /remote/workspace/*" })]),
			fauxAssistantMessage("Blocked by user."),
		]);
		await harness.session.prompt("Run destructive remote command");
		expect(getToolResult(harness, "bash").isError).toBe(true);
		expect(executedCommands.length).toBe(countBeforeDecline);

		await harness.session.prompt("/ssh disconnect");
		expect(isSshEnabled()).toBe(false);
	});
});
