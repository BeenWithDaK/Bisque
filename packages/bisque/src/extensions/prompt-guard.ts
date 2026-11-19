// Llama Prompt Guard screening extension.
// Screens user input, tool results, and untrusted context messages for prompt
// injection when the user has explicitly installed and enabled Prompt Guard via /safety.

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ContextEvent,
	ContextEventResult,
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import type { PromptGuard } from "../models/runner.ts";

const INJECTION_THRESHOLD = 0.8;

let activePromptGuard: PromptGuard | null = null;

export function getPromptGuard(): PromptGuard | null {
	return activePromptGuard;
}

export function setPromptGuard(guard: PromptGuard | null): void {
	activePromptGuard = guard;
}

function extractTextBlocks(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

export function promptGuardExtension(pi: ExtensionAPI): void {
	pi.on("input", async (event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult | undefined> => {
		if (!activePromptGuard || !event.text.trim()) return undefined;
		const check = await activePromptGuard.classify(event.text);
		if (check.injection && check.probability >= INJECTION_THRESHOLD) {
			ctx.ui.notify(
				`Prompt Guard blocked suspected prompt injection (p=${check.probability.toFixed(2)}).`,
				"warning",
			);
			return { action: "handled" };
		}
		return undefined;
	});

	pi.on("tool_result", async (event: ToolResultEvent): Promise<ToolResultEventResult | undefined> => {
		if (!activePromptGuard) return undefined;
		const text = extractTextBlocks(event.content);
		if (!text) return undefined;
		const check = await activePromptGuard.classify(text);
		if (check.injection && check.probability >= INJECTION_THRESHOLD) {
			return {
				content: [
					{
						type: "text",
						text: `[Prompt Guard redacted tool output due to suspected prompt injection (p=${check.probability.toFixed(2)}).]`,
					},
				],
				isError: true,
			};
		}
		return undefined;
	});

	pi.on("context", async (event: ContextEvent): Promise<ContextEventResult | undefined> => {
		if (!activePromptGuard) return undefined;
		let modified = false;
		const screened: AgentMessage[] = [];

		for (const msg of event.messages) {
			if (msg.role === "toolResult") {
				const text = extractTextBlocks(msg.content);
				if (text) {
					const check = await activePromptGuard.classify(text);
					if (check.injection && check.probability >= INJECTION_THRESHOLD) {
						modified = true;
						screened.push({
							...msg,
							content: [
								{
									type: "text",
									text: `[Prompt Guard redacted historical tool output (p=${check.probability.toFixed(2)}).]`,
								},
							],
							isError: true,
						});
						continue;
					}
				}
			}
			screened.push(msg);
		}

		return modified ? { messages: screened } : undefined;
	});
}
