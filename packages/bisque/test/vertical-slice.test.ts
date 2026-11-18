// Vertical-slice and shell tests for Bisque: Goal bubble, pre-stop goal verification,
// Status bar, local usage tracking + provider headers, permission gate, path protection,
// coworker shell/skills/prompts, and restricted config tools.

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	fauxAssistantMessage,
	fauxToolCall,
	getCurrentSystemPrompt,
	type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { DefaultResourceLoader, type ExtensionWidgetOptions } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createHarness,
	createTestUiContext,
	getAssistantTexts,
	getToolResult,
	type Harness,
} from "../../coding-agent/test/suite/harness.ts";
import { GOAL_WIDGET_KEY, getActiveGoal, getPendingGoalReview } from "../src/extensions/goal.ts";
import { bisqueExtensions } from "../src/extensions/index.ts";
import { getConfirmMode, getDecisionModel, setDecisionModel } from "../src/extensions/permission.ts";
import { getPromptGuard } from "../src/extensions/prompt-guard.ts";
import {
	FIVE_HOURS_MS,
	getUsageSnapshot,
	recordUsage,
	SEVEN_DAYS_MS,
	STATUS_WIDGET_KEY,
	setUsageLimits,
} from "../src/extensions/status.ts";

interface WidgetCall {
	content: unknown;
	options: ExtensionWidgetOptions | undefined;
}

describe("Bisque vertical slice", () => {
	const harnesses: Harness[] = [];
	const extraDirs: string[] = [];
	let agentDir = "";

	beforeEach(() => {
		agentDir = join(tmpdir(), `bisque-agent-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(agentDir, { recursive: true });
		extraDirs.push(agentDir);
		process.env.PI_CODING_AGENT_DIR = agentDir;
		process.env.BISQUE_MODELS_DIR = join(agentDir, "models");
	});

	afterEach(() => {
		setDecisionModel(null);
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		while (extraDirs.length > 0) {
			const dir = extraDirs.pop();
			if (dir && existsSync(dir)) {
				rmSync(dir, { recursive: true, force: true });
			}
		}
		delete process.env.PI_CODING_AGENT_DIR;
		delete process.env.BISQUE_MODELS_DIR;
	});

	async function setupBisque(
		options: {
			confirmImpl?: (title: string, message: string) => Promise<boolean>;
			selectImpl?: (title: string, choices: string[]) => Promise<string | undefined>;
		} = {},
	) {
		const widgets = new Map<string, WidgetCall>();
		const notifications: Array<{ message: string; type?: string }> = [];
		const statuses = new Map<string, string | undefined>();
		const confirmCalls: Array<{ title: string; message: string }> = [];
		let customHeaderInstalled = false;
		let titleSet = "";

		const harness = await createHarness({
			models: [{ id: "faux-bisque", name: "Faux Bisque", contextWindow: 200_000, maxTokens: 8_192 }],
			extensionFactories: bisqueExtensions,
		});
		harnesses.push(harness);

		const uiContext = createTestUiContext({
			setWidget: (key: string, content: unknown, widgetOpts?: ExtensionWidgetOptions) => {
				widgets.set(key, { content, options: widgetOpts });
			},
			setStatus: (key: string, text: string | undefined) => {
				statuses.set(key, text);
			},
			setHeader: (factory) => {
				customHeaderInstalled = Boolean(factory);
			},
			setTitle: (title: string) => {
				titleSet = title;
			},
			notify: (message: string, type?: "info" | "warning" | "error") => {
				notifications.push({ message, ...(type ? { type } : {}) });
			},
			confirm: async (title: string, message: string) => {
				confirmCalls.push({ title, message });
				return options.confirmImpl ? options.confirmImpl(title, message) : true;
			},
			select: async (title: string, choices: string[]) => {
				return options.selectImpl ? options.selectImpl(title, choices) : undefined;
			},
		});

		await harness.session.bindExtensions({ uiContext, mode: "tui" });

		return {
			harness,
			widgets,
			notifications,
			statuses,
			confirmCalls,
			customHeaderInstalled: () => customHeaderInstalled,
			titleSet: () => titleSet,
		};
	}

	it("renders Goal bubble, Status bar, TUI header, and interactive /mode selector", async () => {
		let nextSelect: string | undefined;
		const { harness, widgets, customHeaderInstalled, titleSet } = await setupBisque({
			selectImpl: async (_title, choices) => choices.find((c) => nextSelect && c.startsWith(nextSelect)),
		});

		expect(titleSet()).toBe("Bisque");
		expect(customHeaderInstalled()).toBe(true);
		expect(widgets.get(GOAL_WIDGET_KEY)?.content).toBeUndefined();

		const initialStatus = widgets.get(STATUS_WIDGET_KEY);
		expect(initialStatus?.options?.placement).toBe("belowEditor");
		expect(initialStatus?.content).toEqual([
			"Confirm: Manual approve  |  Context remaining: 200,000 tokens (100%)  |  API usage: 5h 100% (500,000 left) · 7d 100%",
		]);

		await harness.session.prompt("/goal Ship Milestone 1.1");

		const goalWidget = widgets.get(GOAL_WIDGET_KEY);
		expect(goalWidget?.options?.placement).toBe("aboveEditor");
		const goalLines = goalWidget?.content as string[];
		expect(goalLines[0]).toBe("Goal: Ship Milestone 1.1");
		expect(goalLines[1]).toMatch(/^Set /);
		expect(getActiveGoal()?.text).toBe("Ship Milestone 1.1");

		// Interactive /mode with no arguments selects via UI menu.
		nextSelect = "Read";
		await harness.session.prompt("/mode");
		expect(getConfirmMode()).toBe("Read");
		const readStatus = widgets.get(STATUS_WIDGET_KEY)?.content as string[];
		expect(readStatus[0]).toContain("Confirm: Read  |  Context remaining:");

		await harness.session.prompt("/goal");
		expect(widgets.get(GOAL_WIDGET_KEY)?.content).toBeUndefined();
		expect(getActiveGoal()).toBeNull();
	});

	it("discovers built-in Bisque coworker skill, prompt templates, and injects coworker persona", async () => {
		const resourceLoader = new DefaultResourceLoader({
			cwd: agentDir,
			agentDir,
			extensionFactories: bisqueExtensions,
		});
		await resourceLoader.reload();

		const harness = await createHarness({
			models: [{ id: "faux-bisque", name: "Faux Bisque", contextWindow: 200_000, maxTokens: 8_192 }],
			resourceLoader,
		});
		harnesses.push(harness);
		await harness.session.bindExtensions({ uiContext: createTestUiContext(), mode: "tui" });

		let systemPromptSeen = "";
		let userPromptSeen = "";

		harness.setResponses([
			(context) => {
				systemPromptSeen = getCurrentSystemPrompt(context.messages) ?? "";
				const lastUser = context.messages.findLast((m) => m.role === "user");
				userPromptSeen = JSON.stringify(lastUser);
				return fauxAssistantMessage("Here is the plain-language plan.");
			},
		]);

		await harness.session.prompt("/plan reorganize project notes");

		expect(systemPromptSeen).toContain("You are Bisque, a calm, plain-language coworker and personal assistant.");
		expect(systemPromptSeen).toContain("bisque-coworker");
		expect(userPromptSeen).toContain(
			"propose a concise, plain-language step-by-step plan for: reorganize project notes",
		);
	});

	it("tracks local 5-hour and 7-day usage windows across assistant responses", async () => {
		const { harness, widgets } = await setupBisque();
		setUsageLimits({ fiveHourTokens: 100_000, weeklyTokens: 400_000 });

		harness.setResponses([fauxAssistantMessage("Completed analysis.")]);

		await harness.session.prompt("Analyze project");

		const postTurnSnap = getUsageSnapshot();
		expect(postTurnSnap.fiveHourUsed).toBeGreaterThan(0);
		expect(postTurnSnap.fiveHourRemaining).toBe(100_000 - postTurnSnap.fiveHourUsed);

		const statusLines = widgets.get(STATUS_WIDGET_KEY)?.content as string[];
		expect(statusLines[0]).toContain("Confirm: Manual approve");
		expect(statusLines[0]).toContain(
			`Context remaining: ${(200_000 - postTurnSnap.fiveHourUsed).toLocaleString()} tokens`,
		);
		expect(statusLines[0]).toContain(`(${postTurnSnap.fiveHourRemaining.toLocaleString()} left)`);

		const baseNow = Date.now();
		recordUsage(25_000, 0.05, baseNow + 1_000);
		const expectedTotal = postTurnSnap.fiveHourUsed + 25_000;
		expect(getUsageSnapshot(baseNow + 2_000).fiveHourUsed).toBe(expectedTotal);

		const afterFiveHours = getUsageSnapshot(baseNow + FIVE_HOURS_MS + 5_000);
		expect(afterFiveHours.fiveHourUsed).toBe(0);
		expect(afterFiveHours.fiveHourRemainingPct).toBe(100);
		expect(afterFiveHours.weeklyUsed).toBe(expectedTotal);

		const afterSevenDays = getUsageSnapshot(baseNow + SEVEN_DAYS_MS + 5_000);
		expect(afterSevenDays.weeklyUsed).toBe(0);
		expect(afterSevenDays.weeklyRemainingPct).toBe(100);
	});

	it("runs vertical slice end-to-end and enforces pre-stop goal verification on premature stops", async () => {
		let allowConfirm = true;
		const { harness, widgets, confirmCalls } = await setupBisque({
			confirmImpl: async () => allowConfirm,
		});

		await harness.session.prompt("/goal Create greeting.txt and verify");
		await harness.session.prompt("/mode Manual approve");

		const targetFile = join(harness.tempDir, "greeting.txt");

		// First turn writes file and stops prematurely ("Wrote file.") without verifying goal;
		// agent_before_settle injects pre-stop goal verification and continues automatically!
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "greeting.txt", content: "hello bisque" })]),
			fauxAssistantMessage("Wrote file."),
			fauxAssistantMessage([
				fauxToolCall("bisque_complete_goal", { summary: "greeting.txt created with expected content" }),
			]),
			fauxAssistantMessage("Greeting created and goal verified."),
		]);

		await harness.session.prompt("Please create greeting.txt");

		expect(confirmCalls).toHaveLength(1);
		expect(confirmCalls[0]?.title).toBe("Allow write?");
		expect(readFileSync(targetFile, "utf-8")).toBe("hello bisque");
		expect(getAssistantTexts(harness)).toContain("Greeting created and goal verified.");

		const goalLines = widgets.get(GOAL_WIDGET_KEY)?.content as string[];
		expect(goalLines[0]).toBe("Goal: Create greeting.txt and verify (verified)");
		expect(goalLines[1]).toBe("Verified: greeting.txt created with expected content");

		const review = getPendingGoalReview();
		expect(review?.verified).toBe(true);
		expect(review?.outcome).toBe("completed");

		// Manual rejection blocks write.
		allowConfirm = false;
		const rejectedFile = join(harness.tempDir, "rejected.txt");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "rejected.txt", content: "nope" })]),
			fauxAssistantMessage("Goal verified: respected user refusal."),
		]);

		await harness.session.prompt("Write rejected.txt");
		expect(existsSync(rejectedFile)).toBe(false);
		expect(getToolResult(harness, "write").isError).toBe(true);
	});

	it("supports Decision Model Auto-Confirm when enabled and falls back to manual confirm on low confidence", async () => {
		let manualConfirmCount = 0;
		const { harness } = await setupBisque({
			confirmImpl: async () => {
				manualConfirmCount++;
				return false;
			},
		});

		await harness.session.prompt("/mode Auto-approve");

		let mockConfidence = { allow: true, probability: 0.92 };
		setDecisionModel({
			classify: async () => mockConfidence,
		});

		const autoAllowedFile = join(harness.tempDir, "auto-ok.txt");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "auto-ok.txt", content: "approved by d1" })]),
			fauxAssistantMessage("Done."),
		]);
		await harness.session.prompt("Write auto-ok.txt");
		expect(manualConfirmCount).toBe(0);
		expect(readFileSync(autoAllowedFile, "utf-8")).toBe("approved by d1");

		// Low confidence (< 0.7) falls back to manual confirmation, which declines here.
		mockConfidence = { allow: true, probability: 0.45 };
		const deniedFile = join(harness.tempDir, "auto-denied.txt");
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "auto-denied.txt", content: "blocked" })]),
			fauxAssistantMessage("Blocked."),
		]);
		await harness.session.prompt("Write auto-denied.txt");
		expect(manualConfirmCount).toBe(1);
		expect(existsSync(deniedFile)).toBe(false);
		expect(getToolResult(harness, "write").isError).toBe(true);
	});

	it("enforces granted-folder path protection and privilege boundaries on config tools", async () => {
		const { harness } = await setupBisque();
		const outsideDir = join(tmpdir(), `bisque-outside-${Date.now()}`);
		mkdirSync(outsideDir, { recursive: true });
		extraDirs.push(outsideDir);
		const outsideFile = join(outsideDir, "secret.txt");

		harness.setResponses([
			fauxAssistantMessage([
				fauxToolCall("write", { path: outsideFile, content: "blocked" }),
				fauxToolCall("bisque_set_setting", { field: "confirmMode", value: "Auto-approve" }),
				fauxToolCall("bisque_set_setting", { field: "usageLimits.fiveHourTokens", value: 250_000 }),
				fauxToolCall("bisque_guide", { field: "confirmMode" }),
			]),
			fauxAssistantMessage("Checked boundaries."),
		]);

		await harness.session.prompt("Test folder and setting boundaries");

		expect(existsSync(outsideFile)).toBe(false);
		expect(getToolResult(harness, "write").isError).toBe(true);

		const setResults = harness.session.messages.filter(
			(m): m is ToolResultMessage => m.role === "toolResult" && m.toolName === "bisque_set_setting",
		);
		expect(setResults[0]?.isError).toBe(true);
		expect(JSON.stringify(setResults[0]?.content)).toContain("run `/mode`");
		expect(setResults[1]?.isError).toBe(false);
		expect(getUsageSnapshot().fiveHourLimit).toBe(250_000);

		const guideResult = getToolResult(harness, "bisque_guide");
		expect(guideResult.isError).toBe(false);
		expect(JSON.stringify(guideResult.content)).toContain("/mode <Read|Manual approve|Auto-approve>");

		// Local models stay OFF by default and cannot be enabled before explicit install.
		expect(getDecisionModel()).toBeNull();
		expect(getPromptGuard()).toBeNull();
		await harness.session.prompt("/safety enable decision-model");
		expect(getDecisionModel()).toBeNull();

		await harness.session.prompt(`/folders add ${outsideDir}`);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: outsideFile, content: "now granted" })]),
			fauxAssistantMessage("Wrote after grant."),
		]);
		await harness.session.prompt("Write to newly granted folder");
		expect(readFileSync(outsideFile, "utf-8")).toBe("now granted");
	});
});
