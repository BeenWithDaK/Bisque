// Commands extension. Registers Bisque slash commands: /goal, /mode, /folders, /safety
// with tab-completion and immediate UI status refreshes.

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getActiveGoal, handleGoalCommand } from "./goal.ts";
import { handleFoldersCommand } from "./paths.ts";
import { CONFIRM_MODES, handleModeCommand } from "./permission.ts";
import { handleSafetyCommand } from "./safety.ts";
import { refreshStatusBar } from "./status.ts";

interface CompletionItem {
	value: string;
	label: string;
	description?: string;
}

function filterCompletions(items: readonly CompletionItem[], prefix: string): CompletionItem[] | null {
	const needle = prefix.trim().toLowerCase();
	const matches = needle
		? items.filter((item) => item.value.toLowerCase().startsWith(needle) || item.label.toLowerCase().includes(needle))
		: [...items];
	return matches.length > 0 ? matches : null;
}

const MODE_COMPLETIONS: readonly CompletionItem[] = CONFIRM_MODES.map((m) => ({
	value: m,
	label: m,
	description:
		m === "Read"
			? "Read-only mode (blocks writes and shell commands)"
			: m === "Manual approve"
				? "Confirm before each write, edit, or shell command"
				: "Delegate approval to local Decision Model when enabled",
}));

const FOLDERS_COMPLETIONS: readonly CompletionItem[] = [
	{ value: "list", label: "list", description: "List granted folders" },
	{ value: "add ", label: "add <path>", description: "Grant Bisque access to a folder" },
	{ value: "remove ", label: "remove <path>", description: "Revoke Bisque access to a folder" },
];

const SAFETY_COMPLETIONS: readonly CompletionItem[] = [
	{ value: "status", label: "status", description: "Show local safety model status" },
	{ value: "menu", label: "menu", description: "Open interactive safety model menu" },
	{
		value: "install decision-model",
		label: "install decision-model",
		description: "Opt in and download Liquid AI d1-2B Decision Model",
	},
	{
		value: "install prompt-guard",
		label: "install prompt-guard",
		description: "Opt in and download Llama Prompt Guard",
	},
	{ value: "enable decision-model", label: "enable decision-model", description: "Activate Decision Model" },
	{ value: "disable decision-model", label: "disable decision-model", description: "Deactivate Decision Model" },
	{ value: "toggle decision-model", label: "toggle decision-model", description: "Toggle Decision Model on/off" },
	{ value: "enable prompt-guard", label: "enable prompt-guard", description: "Activate Prompt Guard" },
	{ value: "disable prompt-guard", label: "disable prompt-guard", description: "Deactivate Prompt Guard" },
	{ value: "toggle prompt-guard", label: "toggle prompt-guard", description: "Toggle Prompt Guard on/off" },
	{
		value: "uninstall decision-model",
		label: "uninstall decision-model",
		description: "Remove Decision Model weights from disk",
	},
	{
		value: "uninstall prompt-guard",
		label: "uninstall prompt-guard",
		description: "Remove Prompt Guard weights from disk",
	},
];

export function commandsExtension(pi: ExtensionAPI): void {
	pi.registerCommand("goal", {
		description: "Set or clear the active Goal Bisque is working toward",
		getArgumentCompletions: (prefix: string) => {
			if (!getActiveGoal()) return null;
			return filterCompletions([{ value: "clear", label: "clear", description: "Clear the active Goal" }], prefix);
		},
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			await handleGoalCommand(args, ctx);
		},
	});

	pi.registerCommand("mode", {
		description: "Set confirmation method: Read, Manual approve, or Auto-approve",
		getArgumentCompletions: (prefix: string) => filterCompletions(MODE_COMPLETIONS, prefix),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			await handleModeCommand(args, ctx);
			refreshStatusBar(ctx);
		},
	});

	pi.registerCommand("folders", {
		description: "Manage granted folders that Bisque can access",
		getArgumentCompletions: (prefix: string) => filterCompletions(FOLDERS_COMPLETIONS, prefix),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			await handleFoldersCommand(args, ctx);
		},
	});

	pi.registerCommand("safety", {
		description: "Safety settings: model status, opt-in download, and on/off toggles",
		getArgumentCompletions: (prefix: string) => filterCompletions(SAFETY_COMPLETIONS, prefix),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			await handleSafetyCommand(args, ctx);
		},
	});
}
