// Safety extension. /safety slash menu: view model status, opt-in SHA-256 verified
// download under ~/.bisque/models/, and on/off toggles for the Decision Model and
// Llama Prompt Guard. Both are OFF by default and never auto-downloaded.

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { OnnxDecisionModel, OnnxPromptGuard, type PipelineLoader } from "../models/runner.ts";
import {
	getModelsDir,
	installModelWeights,
	isInstalled,
	type LocalModelId,
	loadModelCatalog,
	type ModelManifestEntry,
	removeModelWeights,
	saveModelCatalog,
} from "../models/storage.ts";
import { getDecisionModel, setDecisionModel } from "./permission.ts";
import { getPromptGuard, setPromptGuard } from "./prompt-guard.ts";

let models = new Map<LocalModelId, ModelManifestEntry>();
let customFetchFn: typeof fetch | undefined;
let customPipelineLoader: PipelineLoader | undefined;

function isLocalModelId(value: string | undefined): value is LocalModelId {
	return value === "decision-model" || value === "prompt-guard";
}

export function configureSafetyRuntime(options: { fetchFn?: typeof fetch; pipelineLoader?: PipelineLoader }): void {
	customFetchFn = options.fetchFn;
	customPipelineLoader = options.pipelineLoader;
}

export function getSafetyCatalog(): ReadonlyMap<LocalModelId, ModelManifestEntry> {
	return models;
}

async function disposeRunners(): Promise<void> {
	const existingDm = getDecisionModel();
	setDecisionModel(null);
	if (existingDm?.dispose) {
		await existingDm.dispose();
	}

	const existingPg = getPromptGuard();
	setPromptGuard(null);
	if (existingPg?.dispose) {
		await existingPg.dispose();
	}
}

async function syncLoadedRunners(
	current: Map<LocalModelId, ModelManifestEntry>,
	ctx?: ExtensionContext,
): Promise<void> {
	await disposeRunners();

	const dmEntry = current.get("decision-model");
	if (dmEntry?.enabled && dmEntry.installedAt && (Boolean(customPipelineLoader) || isInstalled("decision-model"))) {
		try {
			const dm = new OnnxDecisionModel(customPipelineLoader ? { loader: customPipelineLoader } : {});
			await dm.load();
			setDecisionModel(dm);
		} catch (err) {
			dmEntry.enabled = false;
			saveModelCatalog(current);
			ctx?.ui.notify(
				`Decision Model failed to load and was disabled: ${err instanceof Error ? err.message : String(err)}`,
				"warning",
			);
		}
	}

	const pgEntry = current.get("prompt-guard");
	if (pgEntry?.enabled && pgEntry.installedAt && (Boolean(customPipelineLoader) || isInstalled("prompt-guard"))) {
		try {
			const pg = new OnnxPromptGuard(customPipelineLoader ? { loader: customPipelineLoader } : {});
			await pg.load();
			setPromptGuard(pg);
		} catch (err) {
			pgEntry.enabled = false;
			saveModelCatalog(current);
			ctx?.ui.notify(
				`Prompt Guard failed to load and was disabled: ${err instanceof Error ? err.message : String(err)}`,
				"warning",
			);
		}
	}
}

function formatModelStatus(id: LocalModelId, model: ModelManifestEntry): string {
	const hasWeights = Boolean(model.installedAt) && (Boolean(customPipelineLoader) || isInstalled(id));
	if (model.enabled && hasWeights) return "enabled";
	if (hasWeights) return "installed (off)";
	return "not installed";
}

export function formatSafetyStatus(current: ReadonlyMap<LocalModelId, ModelManifestEntry> = models): string {
	const lines: string[] = [`Bisque safety status (models dir: ${getModelsDir()}):`];
	for (const [key, model] of current) {
		lines.push(`  ${key}: ${model.name} — ${formatModelStatus(key, model)}`);
	}
	lines.push("Local models are OFF by default. Use /safety install <model> to opt in.");
	return lines.join("\n");
}

async function installModelInteractive(modelId: LocalModelId, ctx: ExtensionCommandContext): Promise<void> {
	const model = models.get(modelId);
	if (!model) return;

	const sizeDesc = model.sizeBytes > 0 ? `${model.sizeBytes.toLocaleString()} bytes` : "size determined on download";
	const shaDesc = model.sha256 ? model.sha256 : "computed on install";
	const confirmed = await ctx.ui.confirm(
		`Install ${model.name}?`,
		`Downloads ONNX weights from ${model.url} (${sizeDesc}) into ${getModelsDir()}. SHA-256: ${shaDesc}`,
	);
	if (!confirmed) {
		ctx.ui.notify(`Cancelled installation of ${model.name}.`, "info");
		return;
	}

	try {
		const updated = await installModelWeights(modelId, model, {
			...(customFetchFn ? { fetchFn: customFetchFn } : {}),
			...(ctx.signal ? { signal: ctx.signal } : {}),
		});
		models.set(modelId, updated);
		saveModelCatalog(models);
		ctx.ui.notify(
			`${model.name} installed (${updated.sizeBytes.toLocaleString()} bytes, sha256=${updated.sha256.slice(0, 12)}...). Run /safety enable ${modelId} to activate.`,
			"info",
		);
	} catch (err) {
		ctx.ui.notify(`Failed to install ${model.name}: ${err instanceof Error ? err.message : String(err)}`, "error");
	}
}

export async function handleSafetyCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const parts = args.trim().split(/\s+/);
	const action = parts[0];
	const rawModelName = parts[1];

	if (!action || action === "status") {
		ctx.ui.notify(formatSafetyStatus(models), "info");
		return;
	}

	if (action === "menu") {
		if (!ctx.hasUI) {
			ctx.ui.notify(formatSafetyStatus(models), "info");
			return;
		}
		const options: string[] = [];
		for (const [id, entry] of models) {
			const status = formatModelStatus(id, entry);
			if (status === "not installed") {
				options.push(`Install ${id} — ${entry.name}`);
			} else if (entry.enabled) {
				options.push(`Disable ${id} — ${entry.name} (currently enabled)`);
			} else {
				options.push(`Enable ${id} — ${entry.name} (installed, currently off)`);
			}
		}
		const choice = await ctx.ui.select("Bisque Safety Models", options);
		if (!choice) return;
		if (choice.startsWith("Install ")) {
			const target = choice.split(" ")[1];
			if (isLocalModelId(target)) await installModelInteractive(target, ctx);
		} else if (choice.startsWith("Enable ")) {
			const target = choice.split(" ")[1];
			if (isLocalModelId(target)) await handleSafetyCommand(`enable ${target}`, ctx);
		} else if (choice.startsWith("Disable ")) {
			const target = choice.split(" ")[1];
			if (isLocalModelId(target)) await handleSafetyCommand(`disable ${target}`, ctx);
		}
		return;
	}

	if (action === "install") {
		if (!isLocalModelId(rawModelName)) {
			ctx.ui.notify(`Usage: /safety install <${Array.from(models.keys()).join("|")}>`, "error");
			return;
		}
		await installModelInteractive(rawModelName, ctx);
		return;
	}

	if (action === "uninstall") {
		if (!isLocalModelId(rawModelName)) {
			ctx.ui.notify(`Usage: /safety uninstall <${Array.from(models.keys()).join("|")}>`, "error");
			return;
		}
		const model = models.get(rawModelName)!;
		model.enabled = false;
		delete model.installedAt;
		removeModelWeights(rawModelName);
		saveModelCatalog(models);
		await syncLoadedRunners(models, ctx);
		ctx.ui.notify(`Removed local weights and disabled ${model.name}.`, "info");
		return;
	}

	if (action === "toggle" || action === "enable" || action === "disable") {
		if (!isLocalModelId(rawModelName)) {
			ctx.ui.notify(`Usage: /safety ${action} <${Array.from(models.keys()).join("|")}>`, "error");
			return;
		}
		const model = models.get(rawModelName)!;
		const weightsReady = Boolean(model.installedAt) && (Boolean(customPipelineLoader) || isInstalled(rawModelName));
		if (!weightsReady) {
			ctx.ui.notify(`${model.name} is not installed. Run /safety install ${rawModelName} first.`, "warning");
			return;
		}
		model.enabled = action === "toggle" ? !model.enabled : action === "enable";
		saveModelCatalog(models);
		await syncLoadedRunners(models, ctx);
		ctx.ui.notify(`${model.name} ${model.enabled ? "enabled" : "disabled"}.`, "info");
		return;
	}

	ctx.ui.notify(
		"Usage: /safety <status|menu|install <model>|uninstall <model>|toggle <model>|enable <model>|disable <model>>",
		"error",
	);
}

export function safetyExtension(pi: ExtensionAPI): void {
	models = loadModelCatalog();

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		models = loadModelCatalog();
		await syncLoadedRunners(models, ctx);
		ctx.ui.notify(formatSafetyStatus(models), "info");
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent): Promise<void> => {
		await disposeRunners();
	});
}
