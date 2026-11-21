// Bisque shell extension: plain-language coworker persona, TUI header,
// terminal title, and built-in skills/prompt-templates discovery.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
import { Editor, type EditorTheme, type TUI } from "@earendil-works/pi-tui";
import { ansi256, BISQUE_COLORS } from "./brand.ts";
import { getActiveGoal } from "./extensions/goal.ts";
import { getGrantedFolders } from "./extensions/paths.ts";
import { getConfirmMode } from "./extensions/permission.ts";
import { ensureBisqueDir } from "./storage.ts";

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

	const title = `${ansi256(BISQUE_COLORS.tomato, "Bisque")} ${ansi256(BISQUE_COLORS.cream, "— plain-language coworker shell")}`;
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

export const BISQUE_VERSION = "0.1.0";

export function renderBisqueSplash(mode: string, grantedFolders: number): string[] {
	return [
		"████  █████  ████  ███  █   █ █████",
		"█   █   █   █     █   █ █   █ █",
		"████    █    ███  █   █ █   █ ████",
		"█   █   █       █ █  █  █   █ █",
		"████  █████ ████   ████  ███  █████",
		"",
		"   ∿   ∿   ∿",
		" ╭───────────╮",
		" │           │",
		" ╰───────────╯",
		"",
		"  Comfort food for your computer.",
		"",
		`  bisque v${BISQUE_VERSION} · ${mode} · ${grantedFolders} folder${grantedFolders === 1 ? "" : "s"} granted`,
		"  Type /help to see what I can do.",
	];
}

export function getBisquePromptPrefix(): string {
	const locale = (process.env.LC_ALL || process.env.LANG || "").toUpperCase();
	const mark = locale && !locale.startsWith("C") && locale.includes("UTF") ? "❯" : locale.includes("UTF") ? "❯" : ">";
	return ansi256(BISQUE_COLORS.tomato, `bisque ${mark}`);
}

export class BisqueEditor extends Editor {
	private promptPrefix: string;

	constructor(tui: TUI, theme: EditorTheme) {
		super(tui, theme);
		this.promptPrefix = getBisquePromptPrefix();
	}

	override render(width: number): string[] {
		const lines = super.render(width);
		if (lines.length < 2) return lines;
		lines[1] = `${this.promptPrefix} ${lines[1]}`;
		return lines;
	}
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
			ctx.ui.setEditorComponent((tui, theme) => new BisqueEditor(tui, theme));
			const dir = ensureBisqueDir();
			const marker = join(dir, "splash-shown");
			const showSplash = !existsSync(marker);
			if (showSplash) writeFileSync(marker, "1");
			ctx.ui.setHeader((_tui, theme) => ({
				render(width: number): string[] {
					const header = renderBisqueHeaderLines(theme, width);
					return showSplash
						? [...renderBisqueSplash(getConfirmMode(), getGrantedFolders().length), "", ...header]
						: header;
				},
				invalidate(): void {},
			}));
		}
	});

	pi.on("before_agent_start", (event: BeforeAgentStartEvent): void => {
		event.systemPromptOptions.sections.bisque_coworker = COWORKER_PERSONA;
	});
}
