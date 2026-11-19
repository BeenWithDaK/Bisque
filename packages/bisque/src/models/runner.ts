// Local ONNX Runtime inference wrapper via @xenova/transformers for the
// Liquid AI d1-2B Decision Model and Llama Prompt Guard.
// Loaded lazily via createRequire only after explicit user opt-in (/safety enable),
// falling back to @xenova/transformers' WASM bundle when native binaries (sharp /
// onnxruntime-node) were skipped by --ignore-scripts. Remote model downloads are
// strictly disabled (`env.allowRemoteModels = false`).

import { createRequire } from "node:module";
import type {
	TextClassificationOutput,
	TextClassificationSingle,
	env as TransformersEnv,
	pipeline as TransformersPipeline,
} from "@xenova/transformers";
import { getModelsDir, isInstalled } from "./storage.ts";

interface TransformersRuntime {
	env: typeof TransformersEnv;
	pipeline: typeof TransformersPipeline;
}

const require = createRequire(import.meta.url);
let cachedTransformers: TransformersRuntime | null = null;

export function loadTransformersRuntime(): TransformersRuntime {
	if (cachedTransformers) return cachedTransformers;

	let mod: TransformersRuntime;
	try {
		mod = require("@xenova/transformers") as TransformersRuntime;
	} catch {
		// When installed with --ignore-scripts, sharp's native addon is absent;
		// fall back to @xenova/transformers' self-contained WASM distribution.
		mod = require("@xenova/transformers/dist/transformers.js") as TransformersRuntime;
	}

	mod.env.allowRemoteModels = false;
	mod.env.allowLocalModels = true;
	cachedTransformers = mod;
	return mod;
}

export interface DecisionClassification {
	allow: boolean;
	probability: number;
	label?: string;
}

export interface PromptGuardClassification {
	injection: boolean;
	probability: number;
	label?: string;
}

export interface DecisionModel {
	classify(prompt: string): Promise<DecisionClassification>;
	dispose?(): Promise<void>;
}

export interface PromptGuard {
	classify(text: string): Promise<PromptGuardClassification>;
	dispose?(): Promise<void>;
}

export interface ClassifierRunner {
	(text: string, options?: { topk?: number }): Promise<TextClassificationOutput | TextClassificationOutput[]>;
	dispose?: () => Promise<void>;
}

export type PipelineLoader = (modelId: string, cacheDir: string) => Promise<ClassifierRunner>;

const ALLOW_LABELS = new Set(["allow", "allowed", "approve", "approved", "safe", "benign", "label_1", "1", "true"]);
const INJECTION_LABELS = new Set(["injection", "jailbreak", "unsafe", "malicious", "attack", "label_1", "label_2"]);

async function defaultPipelineLoader(modelId: string, cacheDir: string): Promise<ClassifierRunner> {
	const { pipeline } = loadTransformersRuntime();
	return pipeline("text-classification", modelId, {
		cache_dir: cacheDir,
		local_files_only: true,
		quantized: true,
	});
}

function extractTopPrediction(output: TextClassificationOutput | TextClassificationOutput[]): TextClassificationSingle {
	const first = Array.isArray(output[0]) ? output[0][0] : (output[0] as TextClassificationSingle | undefined);
	if (!first) {
		return { label: "UNKNOWN", score: 0 };
	}
	return first;
}

export class OnnxDecisionModel implements DecisionModel {
	private runner: ClassifierRunner | null = null;
	private readonly modelId: string;
	private readonly loader: PipelineLoader;

	constructor(options: { modelId?: string; loader?: PipelineLoader } = {}) {
		this.modelId = options.modelId ?? "decision-model";
		this.loader = options.loader ?? defaultPipelineLoader;
	}

	async load(): Promise<void> {
		if (this.loader === defaultPipelineLoader && !isInstalled(this.modelId)) {
			throw new Error(
				`Decision Model weights not found under ${getModelsDir()}. Run /safety install decision-model first.`,
			);
		}
		this.runner = await this.loader(this.modelId, getModelsDir());
	}

	async classify(prompt: string): Promise<DecisionClassification> {
		if (!this.runner) {
			throw new Error("Decision Model not loaded. Use /safety install decision-model to opt in.");
		}
		const raw = await this.runner(prompt, { topk: 2 });
		const top = extractTopPrediction(raw);
		const normalized = top.label.trim().toLowerCase();
		const isAllowLabel = ALLOW_LABELS.has(normalized);
		return {
			allow: isAllowLabel,
			probability: isAllowLabel ? top.score : Math.max(0, 1 - top.score),
			label: top.label,
		};
	}

	async dispose(): Promise<void> {
		if (this.runner?.dispose) {
			await this.runner.dispose();
		}
		this.runner = null;
	}
}

export class OnnxPromptGuard implements PromptGuard {
	private runner: ClassifierRunner | null = null;
	private readonly modelId: string;
	private readonly loader: PipelineLoader;

	constructor(options: { modelId?: string; loader?: PipelineLoader } = {}) {
		this.modelId = options.modelId ?? "prompt-guard";
		this.loader = options.loader ?? defaultPipelineLoader;
	}

	async load(): Promise<void> {
		if (this.loader === defaultPipelineLoader && !isInstalled(this.modelId)) {
			throw new Error(
				`Prompt Guard weights not found under ${getModelsDir()}. Run /safety install prompt-guard first.`,
			);
		}
		this.runner = await this.loader(this.modelId, getModelsDir());
	}

	async classify(text: string): Promise<PromptGuardClassification> {
		if (!this.runner) {
			throw new Error("Prompt Guard not loaded. Use /safety install prompt-guard to opt in.");
		}
		const raw = await this.runner(text, { topk: 3 });
		const top = extractTopPrediction(raw);
		const normalized = top.label.trim().toLowerCase();
		const isInjection = INJECTION_LABELS.has(normalized);
		return {
			injection: isInjection,
			probability: isInjection ? top.score : Math.max(0, 1 - top.score),
			label: top.label,
		};
	}

	async dispose(): Promise<void> {
		if (this.runner?.dispose) {
			await this.runner.dispose();
		}
		this.runner = null;
	}
}
