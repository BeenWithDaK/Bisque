// Bisque shell extension: plain-language coworker persona, TUI header,
// terminal title, and built-in skills/prompt-templates discovery.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionContext,
	type ResourcesDiscoverEvent,
	type ResourcesDiscoverResult,
	type SessionStartEvent,
	type Theme,
	truncateLine,
} from "@earendil-works/pi-coding-agent";
import { getActiveGoal } from "./extensions/goal.ts";
import { getGrantedFolders } from "./extensions/paths.ts";
import { getConfirmMode } from "./extensions/permission.ts";

export const BISQUE_SKILLS_DIR = fileURLToPath(new URL("../skills", import.meta.url));
export const BISQUE_PROMPTS_DIR = fileURLToPath(new URL("../prompts", import.meta.url));

const COWORKER_PERSONA = [
	"You are Bisque, a calm, plain-language coworker and personal assistant.",
	"Communicate clearly without unnecessary jargon; define technical terms briefly when they are needed.",
	"Only read or modify files inside folders the user has granted via `/folders`.",
	"Respect the active confirmation method (`/mode`): explain intended changes before running destructive commands.",
	"Never attempt to escalate permissions, grant folders, or enable/download safety models yourself; call `bisque_guide` and give the user the exact slash command.",
].join("\n");

export function renderBisqueHeaderLines(theme: Theme, width: number): string[] {
	const mode = getConfirmMode();
	const foldersCount = getGrantedFolders().length;
	const activeGoal = getActiveGoal();

	const title = `${theme.fg("accent", "Bisque")} ${theme.fg("muted", "— plain-language coworker shell")}`;
	const summary = theme.fg(
		"dim",
		`Mode: ${mode}  |  Granted folders: ${foldersCount}  |  Goal: ${activeGoal ? activeGoal.text : "none"}`,
	);
	const hints = theme.fg(
		"dim",
		"Commands: /goal <task> · /mode · /folders · /safety · /plan <task> · /login (Radius & BYOK)",
	);

	const maxLen = Math.max(20, width);
	return [
		"",
		truncateLine(title, maxLen).text,
		truncateLine(summary, maxLen).text,
		truncateLine(hints, maxLen).text,
		"",
	];
}

export function shellExtension(pi: ExtensionAPI): void {
	pi.on("resources_discover", (_event: ResourcesDiscoverEvent): ResourcesDiscoverResult => {
		const skillPaths = existsSync(BISQUE_SKILLS_DIR) ? [BISQUE_SKILLS_DIR] : [];
		const promptPaths = existsSync(BISQUE_PROMPTS_DIR) ? [BISQUE_PROMPTS_DIR] : [];
		return { skillPaths, promptPaths };
	});

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		if (ctx.hasUI) {
			ctx.ui.setTitle("Bisque");
		}
		if (ctx.mode === "tui") {
			ctx.ui.setHeader((_tui, theme) => ({
				render(width: number): string[] {
					return renderBisqueHeaderLines(theme, width);
				},
				invalidate(): void {},
			}));
		}
	});

	pi.on("before_agent_start", (event: BeforeAgentStartEvent): void => {
		event.systemPromptOptions.sections.bisque_coworker = COWORKER_PERSONA;
	});
}
