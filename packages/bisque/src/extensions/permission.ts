// Permission gate extension. Manual approve by default; Auto-Confirm off by default.
// Asks before write, edit, or shell commands. Auto-Confirm delegates to the local
// ONNX Decision Model only when installed and enabled via /safety.

import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	isToolCallEventType,
	type SessionStartEvent,
	type ToolCallEvent,
	type ToolCallEventResult,
} from "@earendil-works/pi-coding-agent";
import type { DecisionModel } from "../models/runner.ts";
import { readJson, writeJson } from "../storage.ts";
import { getActiveGoal } from "./goal.ts";
import { getGrantedFolders } from "./paths.ts";

export type ConfirmMode = "Read" | "Manual approve" | "Auto-approve";

export const CONFIRM_MODES: readonly ConfirmMode[] = ["Read", "Manual approve", "Auto-approve"];

const MODE_FILE = "confirm-mode.json";
const DEFAULT_MODE: ConfirmMode = "Manual approve";
const WRITE_TOOLS = new Set(["write", "edit", "bash", "powershell"]);
const DECISION_ALLOW_THRESHOLD = 0.7;

let mode: ConfirmMode = DEFAULT_MODE;
let decisionModel: DecisionModel | null = null;

function isConfirmMode(value: unknown): value is ConfirmMode {
	return value === "Read" || value === "Manual approve" || value === "Auto-approve";
}

export function getConfirmMode(): ConfirmMode {
	return mode;
}

export function setDecisionModel(model: DecisionModel | null): void {
	decisionModel = model;
}

export function getDecisionModel(): DecisionModel | null {
	return decisionModel;
}

function applyMode(next: ConfirmMode, ctx: ExtensionContext): void {
	mode = next;
	writeJson(MODE_FILE, next);
	ctx.ui.setStatus("confirm-mode", next);
	ctx.ui.notify(`Confirmation method: ${next}`, "info");
}

export async function handleModeCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const candidate = args.trim();
	if (!candidate && ctx.hasUI) {
		const options = [
			"Manual approve — ask before writing files or running commands",
			"Read — read-only mode, block file changes and commands",
			"Auto-approve — use local Decision Model when installed and enabled",
		];
		const selected = await ctx.ui.select(`Confirmation method (current: ${mode})`, options);
		if (!selected) return;
		const chosen = selected.split(" — ")[0];
		if (isConfirmMode(chosen)) {
			applyMode(chosen, ctx);
		}
		return;
	}

	if (isConfirmMode(candidate)) {
		applyMode(candidate, ctx);
	} else {
		ctx.ui.notify("Usage: /mode <Read|Manual approve|Auto-approve>", "error");
	}
}

function describeToolCall(event: ToolCallEvent): string {
	if (isToolCallEventType("bash", event) || isToolCallEventType("powershell", event)) {
		return event.input.command;
	}
	if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
		return `File: ${event.input.path}`;
	}
	return JSON.stringify(event.input);
}

export function permissionExtension(pi: ExtensionAPI): void {
	const stored = readJson<unknown>(MODE_FILE, DEFAULT_MODE);
	mode = isConfirmMode(stored) ? stored : DEFAULT_MODE;

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		const reloaded = readJson<unknown>(MODE_FILE, DEFAULT_MODE);
		mode = isConfirmMode(reloaded) ? reloaded : DEFAULT_MODE;
		ctx.ui.setStatus("confirm-mode", mode);
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
		if (!WRITE_TOOLS.has(event.toolName)) return undefined;

		if (mode === "Read") {
			return { block: true, reason: "Read mode: file changes and command execution are disabled." };
		}

		if (mode === "Manual approve") {
			if (!ctx.hasUI) {
				return { block: true, reason: "Manual approve required but no UI available." };
			}
			const allowed = await ctx.ui.confirm(`Allow ${event.toolName}?`, describeToolCall(event));
			if (!allowed) {
				return { block: true, reason: "Blocked by user (manual approve)." };
			}
			return undefined;
		}

		if (mode === "Auto-approve") {
			if (decisionModel) {
				const prompt = JSON.stringify({
					active_goal: getActiveGoal()?.text ?? "",
					granted_paths: getGrantedFolders().map((g) => g.path),
					tool_name: event.toolName,
					tool_args: event.input,
				});
				const decision = await decisionModel.classify(prompt);
				if (decision.allow && decision.probability >= DECISION_ALLOW_THRESHOLD) {
					return undefined;
				}
				if (ctx.hasUI) {
					const allowed = await ctx.ui.confirm(
						`Allow ${event.toolName}? (Auto-Confirm p=${decision.probability.toFixed(2)})`,
						describeToolCall(event),
					);
					if (allowed) return undefined;
				}
				return {
					block: true,
					reason: `Auto-Confirm denied (p(allow)=${decision.probability.toFixed(2)}).`,
				};
			}

			if (!ctx.hasUI) {
				return { block: true, reason: "Auto-Confirm not installed and no UI available." };
			}
			const allowed = await ctx.ui.confirm(
				`Allow ${event.toolName}? (Auto-Confirm not installed)`,
				describeToolCall(event),
			);
			if (!allowed) {
				return { block: true, reason: "Blocked by user (manual approve)." };
			}
		}

		return undefined;
	});
}
