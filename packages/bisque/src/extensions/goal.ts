// Goal extension. Renders the active Goal bubble above the input bar, provides
// bisque_complete_goal, and performs pre-stop goal-completion verification.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	AgentActivityOutcome,
	AgentBeforeSettleEvent,
	AgentBeforeSettleEventResult,
	AgentToolResult,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ExtensionUIContext,
	SessionStartEvent,
	ToolDefinition,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { readJson, writeJson } from "../storage.ts";

const GOAL_FILE = "active-goal.json";
export const GOAL_WIDGET_KEY = "bisque-goal-bubble";

export interface GoalState {
	text: string;
	setAt: number;
	verified?: boolean;
	verifiedSummary?: string;
}

export interface GoalReview {
	goal: string;
	outcome: AgentActivityOutcome;
	summary: string;
	verified: boolean;
	requestedAt: number;
}

const CompleteGoalSchema = Type.Object({
	summary: Type.String({ description: "Brief plain-language summary of how the active goal was satisfied" }),
});

type CompleteGoalParams = Static<typeof CompleteGoalSchema>;

let goal: GoalState | null = null;
let pendingGoalReview: GoalReview | null = null;
let lastTurnAssistantText = "";
let checkedBeforeSettleInCurrentRun = false;

export function getActiveGoal(): GoalState | null {
	return goal;
}

export function getPendingGoalReview(): GoalReview | null {
	return pendingGoalReview;
}

export function renderGoalBubble(current: GoalState | null = goal): string[] | undefined {
	if (!current) return undefined;
	const header = current.verified ? `Goal: ${current.text} (verified)` : `Goal: ${current.text}`;
	const detail = current.verifiedSummary
		? `Verified: ${current.verifiedSummary}`
		: `Set ${new Date(current.setAt).toLocaleTimeString()}`;
	return [header, detail];
}

function refreshBubble(ctx: { ui: ExtensionUIContext }): void {
	ctx.ui.setWidget(GOAL_WIDGET_KEY, renderGoalBubble(), { placement: "aboveEditor" });
}

function extractMessageText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function textIndicatesVerifiedOrBlocked(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return false;
	if (trimmed.endsWith("?")) return true;
	const lower = trimmed.toLowerCase();
	return (
		lower.includes("<!-- goal_complete -->") ||
		lower.includes("verified goal") ||
		lower.includes("goal verified") ||
		lower.includes("goal is complete") ||
		lower.includes("goal complete")
	);
}

export async function handleGoalCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const text = args.trim();
	if (text && text.toLowerCase() !== "clear") {
		goal = { text, setAt: Date.now() };
		pendingGoalReview = null;
		checkedBeforeSettleInCurrentRun = false;
		writeJson(GOAL_FILE, goal);
		refreshBubble(ctx);
		ctx.ui.notify(`Goal set: ${text}`, "info");
	} else {
		goal = null;
		pendingGoalReview = null;
		checkedBeforeSettleInCurrentRun = false;
		writeJson<Record<string, never>>(GOAL_FILE, {});
		ctx.ui.setWidget(GOAL_WIDGET_KEY, undefined, { placement: "aboveEditor" });
		ctx.ui.notify("Goal cleared.", "info");
	}
}

export function goalExtension(pi: ExtensionAPI): void {
	const completeGoalTool: ToolDefinition<typeof CompleteGoalSchema> = {
		name: "bisque_complete_goal",
		label: "Complete Bisque goal",
		description: "Mark the active Goal as verified once all parts of the user's goal are satisfied.",
		promptSnippet: "Mark the active Goal verified when all parts of the goal are complete",
		annotations: { readOnlyHint: true, idempotentHint: true },
		parameters: CompleteGoalSchema,
		exposure: "direct",
		execute: async (_id, params: CompleteGoalParams, _signal, _onUpdate, ctx): Promise<AgentToolResult<unknown>> => {
			if (!goal) {
				return {
					content: [{ type: "text", text: "No active goal is set." }],
					details: {},
					isError: false,
				};
			}
			goal = {
				...goal,
				verified: true,
				verifiedSummary: params.summary.trim(),
			};
			writeJson(GOAL_FILE, goal);
			refreshBubble(ctx);
			return {
				content: [{ type: "text", text: `Goal marked verified: ${goal.text}` }],
				details: {},
				isError: false,
			};
		},
	};

	pi.registerTool(completeGoalTool);

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		const parsed = readJson<Partial<GoalState>>(GOAL_FILE, {});
		if (typeof parsed.text === "string" && parsed.text.length > 0 && typeof parsed.setAt === "number") {
			goal = {
				text: parsed.text,
				setAt: parsed.setAt,
				...(typeof parsed.verified === "boolean" ? { verified: parsed.verified } : {}),
				...(typeof parsed.verifiedSummary === "string" ? { verifiedSummary: parsed.verifiedSummary } : {}),
			};
		} else {
			goal = null;
		}
		pendingGoalReview = null;
		lastTurnAssistantText = "";
		checkedBeforeSettleInCurrentRun = false;
		refreshBubble(ctx);
	});

	pi.on("before_agent_start", (event: BeforeAgentStartEvent): void => {
		if (event.messageType === "user") {
			checkedBeforeSettleInCurrentRun = false;
			if (goal?.verified) {
				// A new user prompt re-opens verification against the active goal.
				const { verified: _v, verifiedSummary: _s, ...rest } = goal;
				goal = rest;
				writeJson(GOAL_FILE, goal);
			}
		}
		if (!goal) return;
		event.systemPromptOptions.sections.bisque_goal = [
			`Active goal: ${goal.text}`,
			"Before finishing, verify that every part of this goal has been met.",
			"Call `bisque_complete_goal` once verified, or ask a clear question if blocked on user input.",
		].join("\n");
	});

	pi.on("turn_end", (event: TurnEndEvent, ctx: ExtensionContext): void => {
		if (!goal) return;

		lastTurnAssistantText = extractMessageText(event.message);
		const verified = Boolean(goal.verified) || textIndicatesVerifiedOrBlocked(lastTurnAssistantText);
		const summary = [
			`Outcome: ${event.outcome}`,
			lastTurnAssistantText ? `Last assistant message: ${lastTurnAssistantText.slice(0, 200)}` : "",
			event.toolResults.length > 0 ? `Tool results: ${event.toolResults.length}` : "",
		]
			.filter(Boolean)
			.join("\n");

		pendingGoalReview = {
			goal: goal.text,
			outcome: event.outcome,
			summary,
			verified,
			requestedAt: Date.now(),
		};
		refreshBubble(ctx);
	});

	// Pre-settlement verification: if the agent is about to stop on an unverified goal,
	// inject one verification turn so premature stops are caught automatically.
	pi.on("agent_before_settle", (event: AgentBeforeSettleEvent): AgentBeforeSettleEventResult | undefined => {
		if (!goal || goal.verified || event.outcome !== "completed" || checkedBeforeSettleInCurrentRun) {
			return undefined;
		}
		if (textIndicatesVerifiedOrBlocked(lastTurnAssistantText)) {
			return undefined;
		}

		checkedBeforeSettleInCurrentRun = true;
		return {
			entries: [
				{
					type: "custom_message",
					customType: "bisque-goal-verification",
					content: `Pre-stop goal check: Active goal is "${goal.text}". Verify whether every part of this goal is complete. If incomplete, finish the remaining steps now; if complete, call bisque_complete_goal or confirm goal completion.`,
					display: false,
				},
			],
			continue: true,
		};
	});
}
