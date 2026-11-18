// Config-tools extension. Safe agent-callable configuration tools with strict
// privilege boundaries. Restricted changes (Auto-approve, safety toggles,
// folder grants, model downloads) cannot be done by the agent directly —
// Bisque uses the guide tool to tell the user the exact slash command.

import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { getActiveGoal } from "./goal.ts";
import { getGrantedFolders } from "./paths.ts";
import { getConfirmMode, getDecisionModel } from "./permission.ts";
import { getPromptGuard } from "./prompt-guard.ts";
import { getUsageLimits, getUsageSnapshot, refreshStatusBar, setUsageLimits } from "./status.ts";

const RESTRICTED_FIELDS = new Set([
	"confirmMode",
	"localModels.decision-model.enabled",
	"localModels.decision-model.install",
	"localModels.prompt-guard.enabled",
	"localModels.prompt-guard.install",
	"grantedFolders",
]);

export function isRestrictedSetting(field: string): boolean {
	return (
		RESTRICTED_FIELDS.has(field) ||
		field.startsWith("localModels.") ||
		field.startsWith("grantedFolders") ||
		field === "confirmMode"
	);
}

const GetSettingSchema = Type.Object({
	field: Type.String({
		description:
			"Setting field to read (confirmMode, activeGoal, grantedFolders, localModels.decision-model.enabled, localModels.prompt-guard.enabled, usageLimits.fiveHourTokens, usageLimits.weeklyTokens, usageSnapshot)",
	}),
});

type GetSettingParams = Static<typeof GetSettingSchema>;

const SetSettingSchema = Type.Object({
	field: Type.String({ description: "Settings field to update" }),
	value: Type.Unknown({ description: "New value" }),
});

type SetSettingParams = Static<typeof SetSettingSchema>;

export function configToolsExtension(pi: ExtensionAPI): void {
	const getSetting: ToolDefinition<typeof GetSettingSchema> = {
		name: "bisque_get_setting",
		label: "Get Bisque setting",
		description: "Read a Bisque setting value or current safety/usage state. Safe for the agent to call.",
		promptSnippet: "Read Bisque settings (confirmation mode, granted folders, goal, safety models, usage limits)",
		annotations: { readOnlyHint: true, idempotentHint: true },
		parameters: GetSettingSchema,
		exposure: "direct",
		execute: async (_id: string, params: GetSettingParams): Promise<AgentToolResult<unknown>> => {
			const limits = getUsageLimits();
			const known: Record<string, unknown> = {
				confirmMode: getConfirmMode(),
				activeGoal: getActiveGoal(),
				"localModels.decision-model.enabled": Boolean(getDecisionModel()),
				"localModels.prompt-guard.enabled": Boolean(getPromptGuard()),
				grantedFolders: getGrantedFolders(),
				"usageLimits.fiveHourTokens": limits.fiveHourTokens,
				"usageLimits.weeklyTokens": limits.weeklyTokens,
				usageSnapshot: getUsageSnapshot(),
			};
			const value = known[params.field];
			return {
				content: [{ type: "text", text: JSON.stringify(value ?? null) }],
				details: {},
				isError: false,
			};
		},
	};

	const setSetting: ToolDefinition<typeof SetSettingSchema> = {
		name: "bisque_set_setting",
		label: "Set Bisque setting",
		description:
			"Change a non-restricted Bisque setting (such as local token usage limits). Security-sensitive settings require user slash commands.",
		promptSnippet: "Update safe Bisque settings (restricted privilege changes are refused)",
		promptGuidelines: [
			"Never attempt to bypass confirmation mode, folder grants, or safety model toggles; use bisque_guide to give the user the exact slash command instead.",
		],
		parameters: SetSettingSchema,
		exposure: "direct",
		execute: async (_id, params: SetSettingParams, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> => {
			if (isRestrictedSetting(params.field)) {
				const command = fieldToSlashCommand(params.field);
				return {
					content: [
						{
							type: "text",
							text: `Cannot set "${params.field}" via agent tool (restricted). User action required: run \`/${command}\` in Bisque.`,
						},
					],
					details: {},
					isError: true,
				};
			}

			if (params.field === "usageLimits.fiveHourTokens" || params.field === "usageLimits.weeklyTokens") {
				if (typeof params.value !== "number" || !Number.isFinite(params.value) || params.value <= 0) {
					return {
						content: [{ type: "text", text: `"${params.field}" requires a positive number of tokens.` }],
						details: {},
						isError: true,
					};
				}
				const updated =
					params.field === "usageLimits.fiveHourTokens"
						? setUsageLimits({ fiveHourTokens: params.value })
						: setUsageLimits({ weeklyTokens: params.value });
				refreshStatusBar(ctx);
				return {
					content: [{ type: "text", text: JSON.stringify(updated) }],
					details: {},
					isError: false,
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Setting "${params.field}" is not agent-settable. Use a slash command to change Bisque settings.`,
					},
				],
				details: {},
				isError: true,
			};
		},
	};

	const guideTool: ToolDefinition<typeof GetSettingSchema> = {
		name: "bisque_guide",
		label: "Bisque guide",
		description:
			"Look up the exact slash command or action a user needs to take for a restricted setting or onboarding step.",
		promptSnippet: "Look up exact Bisque slash commands to guide the user on restricted actions",
		annotations: { readOnlyHint: true, idempotentHint: true },
		parameters: GetSettingSchema,
		exposure: "direct",
		execute: async (_id: string, params: GetSettingParams): Promise<AgentToolResult<unknown>> => {
			const command = fieldToSlashCommand(params.field);
			return {
				content: [{ type: "text", text: guideForField(params.field, command) }],
				details: {},
				isError: false,
			};
		},
	};

	pi.registerTool(getSetting);
	pi.registerTool(setSetting);
	pi.registerTool(guideTool);
}

function fieldToSlashCommand(field: string): string {
	switch (field) {
		case "confirmMode":
			return "mode";
		case "localModels.decision-model.install":
			return "safety install decision-model";
		case "localModels.decision-model.enabled":
			return "safety toggle decision-model";
		case "localModels.prompt-guard.install":
			return "safety install prompt-guard";
		case "localModels.prompt-guard.enabled":
			return "safety toggle prompt-guard";
		case "grantedFolders":
			return "folders";
		case "activeGoal":
			return "goal";
		case "apiKeys":
		case "login":
			return "login";
		default:
			if (field.startsWith("localModels.")) return "safety";
			if (field.startsWith("grantedFolders")) return "folders";
			return "settings";
	}
}

function guideForField(field: string, command: string): string {
	switch (field) {
		case "confirmMode":
			return `To change the confirmation method, run \`/${command} <Read|Manual approve|Auto-approve>\`. Auto-approve requires the Decision Model to be installed and enabled first.`;
		case "localModels.decision-model.install":
		case "localModels.decision-model.enabled":
			return "To use the local Decision Model (Auto-Confirm), run `/safety install decision-model` (requires explicit download confirmation), then `/safety enable decision-model`.";
		case "localModels.prompt-guard.install":
		case "localModels.prompt-guard.enabled":
			return "To use Llama Prompt Guard screening, run `/safety install prompt-guard` (requires explicit download confirmation), then `/safety enable prompt-guard`.";
		case "grantedFolders":
			return `To grant folder access, run \`/${command} add <path>\`. To revoke access, run \`/${command} remove <path>\`.`;
		case "activeGoal":
			return "To set a goal, run `/goal <what you want done>`. Run `/goal` with no arguments to clear it.";
		case "apiKeys":
		case "login":
			return "Configure provider credentials via `/login` (including Radius, Anthropic, OpenAI, and Google) or set keys in `.env` (see `.env.example`).";
		default:
			return `Run \`/${command}\` to adjust this setting through the Bisque shell.`;
	}
}
