// Path protection extension. Enforces "granted folders only" — ON by default.
// Bisque only touches folders the user has explicitly granted access to.

import { isAbsolute, relative, resolve } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	isToolCallEventType,
	type SessionStartEvent,
	type ToolCallEvent,
	type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import { readJson, writeJson } from "../storage.ts";

export interface GrantedFolder {
	path: string;
	grantedAt: number;
}

const GRANTED_FOLDERS_FILE = "granted-folders.json";

let grantedFolders: GrantedFolder[] = [];

function isPathWithin(folder: string, target: string): boolean {
	const rel = relative(resolve(folder), resolve(target));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function isPathGranted(target: string, folders: readonly GrantedFolder[] = grantedFolders): boolean {
	return folders.some((f) => isPathWithin(f.path, target));
}

export function getGrantedFolders(): readonly GrantedFolder[] {
	return grantedFolders;
}

export async function handleFoldersCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const trimmed = args.trim();
	const parts = trimmed ? trimmed.split(/\s+/) : [];
	const action = parts[0];
	const rawPath = parts.slice(1).join(" ");

	if (!action || action === "list") {
		if (grantedFolders.length === 0) {
			ctx.ui.notify("No granted folders. Use /folders add <path> to grant access.", "info");
		} else {
			ctx.ui.notify(
				`Granted folders:\n${grantedFolders.map((f) => `  ${f.path}`).join("\n")}\nManage with /folders <add|remove> <path>`,
				"info",
			);
		}
		return;
	}

	if (action === "add") {
		if (!rawPath) {
			ctx.ui.notify("Usage: /folders add <path>", "error");
			return;
		}
		const resolved = resolve(ctx.cwd, rawPath);
		if (!isPathGranted(resolved, grantedFolders)) {
			grantedFolders.push({ path: resolved, grantedAt: Date.now() });
			writeJson(GRANTED_FOLDERS_FILE, grantedFolders);
		}
		ctx.ui.notify(`Granted access to: ${resolved}`, "info");
		return;
	}

	if (action === "remove") {
		if (!rawPath) {
			ctx.ui.notify("Usage: /folders remove <path>", "error");
			return;
		}
		const resolved = resolve(ctx.cwd, rawPath);
		const before = grantedFolders.length;
		grantedFolders = grantedFolders.filter((f) => resolve(f.path) !== resolved);
		writeJson(GRANTED_FOLDERS_FILE, grantedFolders);
		if (grantedFolders.length < before) {
			ctx.ui.notify(`Revoked access to: ${resolved}`, "info");
		} else {
			ctx.ui.notify(`Path not granted: ${resolved}`, "info");
		}
		return;
	}

	ctx.ui.notify("Usage: /folders <add|list|remove> [path]", "error");
}

function collectCandidatePaths(event: ToolCallEvent, cwd: string): string[] {
	if (
		isToolCallEventType("read", event) ||
		isToolCallEventType("write", event) ||
		isToolCallEventType("edit", event)
	) {
		return [resolve(cwd, event.input.path)];
	}
	if (isToolCallEventType("ls", event) || isToolCallEventType("find", event) || isToolCallEventType("grep", event)) {
		return [resolve(cwd, event.input.path ?? ".")];
	}
	if (isToolCallEventType("bash", event) || isToolCallEventType("powershell", event)) {
		return [resolve(cwd)];
	}
	const paths: string[] = [];
	if (typeof event.input.path === "string") {
		paths.push(resolve(cwd, event.input.path));
	}
	if (typeof event.input.cwd === "string") {
		paths.push(resolve(cwd, event.input.cwd));
	}
	return paths;
}

export function pathsExtension(pi: ExtensionAPI): void {
	grantedFolders = readJson<GrantedFolder[]>(GRANTED_FOLDERS_FILE, []);

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		grantedFolders = readJson<GrantedFolder[]>(GRANTED_FOLDERS_FILE, []);
		if (grantedFolders.length === 0) {
			const resolvedCwd = resolve(ctx.cwd);
			grantedFolders = [{ path: resolvedCwd, grantedAt: Date.now() }];
			writeJson(GRANTED_FOLDERS_FILE, grantedFolders);
			ctx.ui.notify(`Bisque granted access to: ${resolvedCwd}`, "info");
		}
	});

	pi.on("tool_call", (event: ToolCallEvent, ctx: ExtensionContext): ToolCallEventResult | undefined => {
		for (const candidate of collectCandidatePaths(event, ctx.cwd)) {
			if (!isPathGranted(candidate, grantedFolders)) {
				return {
					block: true,
					reason: `Path not granted: ${candidate}. Use /folders add <path> to grant access.`,
				};
			}
		}
		return undefined;
	});
}
