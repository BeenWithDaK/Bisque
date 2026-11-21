// Status bar extension. Renders a single-line status bar below the input bar
// showing: confirmation method, context remaining, and locally tracked API usage remaining.

import type {
	AfterProviderResponseEvent,
	ContextUsage,
	ExtensionAPI,
	ExtensionContext,
	MessageEndEvent,
	SessionStartEvent,
	TurnEndEvent,
} from "@earendil-works/pi-coding-agent";
import { ansi256, BISQUE_COLORS } from "../brand.ts";
import { readJson, writeJson } from "../storage.ts";
import { getConfirmMode } from "./permission.ts";

export const STATUS_WIDGET_KEY = "bisque-status-bar";

const USAGE_LIMITS_FILE = "usage-limits.json";
const USAGE_LEDGER_FILE = "usage-ledger.json";

export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface UsageLimits {
	fiveHourTokens: number;
	weeklyTokens: number;
}

export interface UsageLedgerEntry {
	timestamp: number;
	tokens: number;
	cost: number;
}

export interface UsageSnapshot {
	fiveHourUsed: number;
	fiveHourLimit: number;
	fiveHourRemaining: number;
	fiveHourRemainingPct: number;
	weeklyUsed: number;
	weeklyLimit: number;
	weeklyRemaining: number;
	weeklyRemainingPct: number;
	providerRemainingPct: number | null;
}

export const DEFAULT_USAGE_LIMITS: UsageLimits = {
	fiveHourTokens: 500_000,
	weeklyTokens: 5_000_000,
};

let usageLimits: UsageLimits = { ...DEFAULT_USAGE_LIMITS };
let usageLedger: UsageLedgerEntry[] = [];
let providerRemainingPct: number | null = null;

function loadUsageState(): void {
	const storedLimits = readJson<Partial<UsageLimits>>(USAGE_LIMITS_FILE, {});
	usageLimits = {
		fiveHourTokens:
			typeof storedLimits.fiveHourTokens === "number" && storedLimits.fiveHourTokens > 0
				? storedLimits.fiveHourTokens
				: DEFAULT_USAGE_LIMITS.fiveHourTokens,
		weeklyTokens:
			typeof storedLimits.weeklyTokens === "number" && storedLimits.weeklyTokens > 0
				? storedLimits.weeklyTokens
				: DEFAULT_USAGE_LIMITS.weeklyTokens,
	};

	const storedLedger = readJson<unknown>(USAGE_LEDGER_FILE, []);
	if (Array.isArray(storedLedger)) {
		const cutoff = Date.now() - SEVEN_DAYS_MS;
		usageLedger = storedLedger.filter(
			(entry): entry is UsageLedgerEntry =>
				typeof entry === "object" &&
				entry !== null &&
				typeof (entry as UsageLedgerEntry).timestamp === "number" &&
				typeof (entry as UsageLedgerEntry).tokens === "number" &&
				typeof (entry as UsageLedgerEntry).cost === "number" &&
				(entry as UsageLedgerEntry).timestamp >= cutoff,
		);
	} else {
		usageLedger = [];
	}
}

export function getUsageLimits(): UsageLimits {
	return { ...usageLimits };
}

export function setUsageLimits(next: Partial<UsageLimits>): UsageLimits {
	if (typeof next.fiveHourTokens === "number" && Number.isFinite(next.fiveHourTokens) && next.fiveHourTokens > 0) {
		usageLimits.fiveHourTokens = Math.round(next.fiveHourTokens);
	}
	if (typeof next.weeklyTokens === "number" && Number.isFinite(next.weeklyTokens) && next.weeklyTokens > 0) {
		usageLimits.weeklyTokens = Math.round(next.weeklyTokens);
	}
	writeJson(USAGE_LIMITS_FILE, usageLimits);
	return getUsageLimits();
}

export function recordUsage(tokens: number, cost: number, timestamp = Date.now()): void {
	const cutoff = timestamp - SEVEN_DAYS_MS;
	usageLedger = usageLedger.filter((entry) => entry.timestamp >= cutoff);
	usageLedger.push({ timestamp, tokens, cost });
	writeJson(USAGE_LEDGER_FILE, usageLedger);
}

export function getUsageSnapshot(now = Date.now()): UsageSnapshot {
	const fiveHourCutoff = now - FIVE_HOURS_MS;
	const weeklyCutoff = now - SEVEN_DAYS_MS;
	let fiveHourUsed = 0;
	let weeklyUsed = 0;

	for (const entry of usageLedger) {
		if (entry.timestamp >= weeklyCutoff) {
			weeklyUsed += entry.tokens;
		}
		if (entry.timestamp >= fiveHourCutoff) {
			fiveHourUsed += entry.tokens;
		}
	}

	const fiveHourRemaining = Math.max(0, usageLimits.fiveHourTokens - fiveHourUsed);
	const weeklyRemaining = Math.max(0, usageLimits.weeklyTokens - weeklyUsed);
	const fiveHourRemainingPct =
		usageLimits.fiveHourTokens > 0
			? Math.max(0, Math.round((fiveHourRemaining / usageLimits.fiveHourTokens) * 100))
			: 100;
	const weeklyRemainingPct =
		usageLimits.weeklyTokens > 0 ? Math.max(0, Math.round((weeklyRemaining / usageLimits.weeklyTokens) * 100)) : 100;

	return {
		fiveHourUsed,
		fiveHourLimit: usageLimits.fiveHourTokens,
		fiveHourRemaining,
		fiveHourRemainingPct,
		weeklyUsed,
		weeklyLimit: usageLimits.weeklyTokens,
		weeklyRemaining,
		weeklyRemainingPct,
		providerRemainingPct,
	};
}

function parseRateLimitHeaders(headers: Record<string, string>): number | null {
	const remainingRaw = headers["anthropic-ratelimit-tokens-remaining"] ?? headers["x-ratelimit-remaining-tokens"];
	const limitRaw = headers["anthropic-ratelimit-tokens-limit"] ?? headers["x-ratelimit-limit-tokens"];
	if (!remainingRaw || !limitRaw) return null;
	const remaining = Number(remainingRaw);
	const limit = Number(limitRaw);
	if (!Number.isFinite(remaining) || !Number.isFinite(limit) || limit <= 0) return null;
	return Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
}

export function formatContextRemaining(usage: ContextUsage | undefined): string {
	if (!usage || usage.tokens === null || usage.contextWindow <= 0) {
		return "Context remaining: unknown";
	}
	const remaining = Math.max(0, usage.contextWindow - usage.tokens);
	const pct =
		usage.percent !== null
			? Math.max(0, Math.round(100 - usage.percent))
			: Math.max(0, Math.round((remaining / usage.contextWindow) * 100));
	return `Context: ${pct}% left`;
}

export function formatUsageRemaining(now = Date.now()): string {
	const snap = getUsageSnapshot(now);
	const meter = (pct: number): string => {
		const filled = Math.round(pct / 10);
		return `[${"▓".repeat(filled)}${"░".repeat(10 - filled)}]`;
	};
	const base = `5h ${meter(snap.fiveHourRemainingPct)} ${snap.fiveHourRemainingPct}% · 7d ${meter(snap.weeklyRemainingPct)} ${snap.weeklyRemainingPct}%`;
	if (snap.providerRemainingPct !== null) {
		return `${base} · provider ${snap.providerRemainingPct}%`;
	}
	return base;
}

export function renderStatusBar(ctx: ExtensionContext, now = Date.now()): string[] {
	const mode = getConfirmMode();
	const contextUsage = ctx.getContextUsage();
	const modeColor =
		mode === "Read" ? BISQUE_COLORS.sage : mode === "Manual approve" ? BISQUE_COLORS.amber : BISQUE_COLORS.tomato;
	return [
		`${ansi256(modeColor, mode)}  |  ${ansi256(BISQUE_COLORS.cream, formatContextRemaining(contextUsage))}  |  ${formatUsageRemaining(now)}`,
	];
}

export function refreshStatusBar(ctx: ExtensionContext): void {
	ctx.ui.setWidget(STATUS_WIDGET_KEY, renderStatusBar(ctx), { placement: "belowEditor" });
}

export function statusExtension(pi: ExtensionAPI): void {
	loadUsageState();

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		loadUsageState();
		providerRemainingPct = null;
		refreshStatusBar(ctx);
	});

	pi.on("after_provider_response", (event: AfterProviderResponseEvent): void => {
		const parsed = parseRateLimitHeaders(event.headers);
		if (parsed !== null) {
			providerRemainingPct = parsed;
		}
	});

	pi.on("message_end", async (event: MessageEndEvent, ctx: ExtensionContext): Promise<void> => {
		if (event.message.role === "assistant") {
			const { usage } = event.message;
			const tokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
			if (tokens > 0 || usage.cost.total > 0) {
				recordUsage(tokens, usage.cost.total, event.message.timestamp || Date.now());
			}
		}
		refreshStatusBar(ctx);
	});

	pi.on("turn_end", async (_event: TurnEndEvent, ctx: ExtensionContext): Promise<void> => {
		refreshStatusBar(ctx);
	});
}
