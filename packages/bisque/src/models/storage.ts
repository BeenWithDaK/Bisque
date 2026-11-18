// Local model weight storage convention under ~/.bisque/models/ (or BISQUE_MODELS_DIR).
// Versioned manifest with SHA-256 verification and atomic writes.
// Never downloaded automatically — explicit /safety install <model> opt-in required.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type LocalModelId = "decision-model" | "prompt-guard";

export interface ModelArtifactSpec {
	relativePath: string;
	url: string;
	sha256: string;
	sizeBytes: number;
}

export interface ModelManifestEntry {
	name: string;
	version: string;
	url: string;
	sha256: string;
	sizeBytes: number;
	artifacts?: ModelArtifactSpec[];
	installedAt?: number;
	enabled: boolean;
}

export interface InstallModelOptions {
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	onProgress?: (loadedBytes: number, totalBytes: number) => void;
}

export const DEFAULT_MODEL_MANIFEST: Record<LocalModelId, ModelManifestEntry> = {
	"decision-model": {
		name: "Liquid AI d1-2B (Decision Model)",
		version: "1.0.0",
		url: "https://models.bisque.dev/decision-model/v1/onnx/model_quantized.onnx",
		sha256: "",
		sizeBytes: 0,
		enabled: false,
	},
	"prompt-guard": {
		name: "Llama Prompt Guard",
		version: "1.0.0",
		url: "https://models.bisque.dev/prompt-guard/v1/onnx/model_quantized.onnx",
		sha256: "",
		sizeBytes: 0,
		enabled: false,
	},
};

export function getModelsDir(): string {
	return process.env.BISQUE_MODELS_DIR || join(process.env.HOME || homedir(), ".bisque", "models");
}

export function ensureModelsDir(): string {
	const dir = getModelsDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function readManifest(): Record<string, ModelManifestEntry> {
	const manifestFile = join(getModelsDir(), "manifest.json");
	if (!existsSync(manifestFile)) return {};
	try {
		const raw = readFileSync(manifestFile, "utf-8");
		return JSON.parse(raw) as Record<string, ModelManifestEntry>;
	} catch {
		return {};
	}
}

export function writeManifest(manifest: Record<string, ModelManifestEntry>): void {
	const dir = ensureModelsDir();
	const manifestFile = join(dir, "manifest.json");
	const tmpPath = `${manifestFile}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
	renameSync(tmpPath, manifestFile);
}

export function loadModelCatalog(): Map<LocalModelId, ModelManifestEntry> {
	const stored = readManifest();
	const map = new Map<LocalModelId, ModelManifestEntry>();
	for (const id of ["decision-model", "prompt-guard"] as const) {
		const def = DEFAULT_MODEL_MANIFEST[id];
		const existing = stored[id];
		map.set(id, existing ? { ...def, ...existing } : { ...def });
	}
	return map;
}

export function saveModelCatalog(catalog: ReadonlyMap<string, ModelManifestEntry>): void {
	const record: Record<string, ModelManifestEntry> = {};
	for (const [key, entry] of catalog) {
		record[key] = { ...entry };
	}
	writeManifest(record);
}

/** Primary ONNX weights path inside the @xenova/transformers local cache layout. */
export function modelPath(name: string): string {
	const nested = join(getModelsDir(), name, "onnx", "model_quantized.onnx");
	if (existsSync(nested)) return nested;
	const legacyFlat = join(getModelsDir(), `${name}.onnx`);
	if (existsSync(legacyFlat)) return legacyFlat;
	return nested;
}

export function isInstalled(name: string): boolean {
	return existsSync(modelPath(name));
}

export function computeSha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function verifySha256(bytes: Uint8Array, expectedSha256: string, label: string): string {
	const actual = computeSha256(bytes);
	const expected = expectedSha256.trim().toLowerCase();
	if (expected.length > 0 && actual !== expected) {
		throw new Error(`SHA-256 verification failed for ${label}: expected ${expected}, got ${actual}`);
	}
	return actual;
}

function writeVerifiedFile(destPath: string, bytes: Uint8Array): void {
	mkdirSync(dirname(destPath), { recursive: true });
	const tmpPath = `${destPath}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmpPath, bytes);
	renameSync(tmpPath, destPath);
}

/**
 * Install model weights after explicit user confirmation.
 * If verified weights are already staged locally on disk, registers them without network access;
 * otherwise downloads over HTTPS, verifies SHA-256, and writes atomically under ~/.bisque/models/.
 */
export async function installModelWeights(
	id: LocalModelId,
	entry: ModelManifestEntry,
	options: InstallModelOptions = {},
): Promise<ModelManifestEntry> {
	ensureModelsDir();
	const existingPath = modelPath(id);
	if (existsSync(existingPath)) {
		const bytes = readFileSync(existingPath);
		const actualSha = verifySha256(bytes, entry.sha256, entry.name);
		const stats = statSync(existingPath);
		return {
			...entry,
			sha256: entry.sha256 || actualSha,
			sizeBytes: stats.size,
			installedAt: Date.now(),
		};
	}

	const fetchFn = options.fetchFn ?? globalThis.fetch;
	const artifacts: ModelArtifactSpec[] = entry.artifacts?.length
		? entry.artifacts
		: [
				{
					relativePath: "onnx/model_quantized.onnx",
					url: entry.url,
					sha256: entry.sha256,
					sizeBytes: entry.sizeBytes,
				},
			];

	let totalLoaded = 0;
	const totalExpected = artifacts.reduce((sum, item) => sum + item.sizeBytes, 0);
	let primarySha = entry.sha256;

	for (const artifact of artifacts) {
		const response = await fetchFn(artifact.url, options.signal ? { signal: options.signal } : undefined);
		if (!response.ok) {
			throw new Error(`Failed to download ${artifact.url} (HTTP ${response.status})`);
		}
		const buffer = new Uint8Array(await response.arrayBuffer());
		const verifiedSha = verifySha256(buffer, artifact.sha256, `${entry.name} (${artifact.relativePath})`);
		const destPath = join(getModelsDir(), id, artifact.relativePath);
		writeVerifiedFile(destPath, buffer);
		if (artifact.relativePath.endsWith(".onnx")) {
			primarySha = artifact.sha256 || verifiedSha;
		}
		totalLoaded += buffer.byteLength;
		options.onProgress?.(totalLoaded, Math.max(totalExpected, totalLoaded));
	}

	return {
		...entry,
		sha256: primarySha,
		sizeBytes: totalLoaded,
		installedAt: Date.now(),
	};
}

export function removeModelWeights(id: LocalModelId): void {
	const nestedDir = join(getModelsDir(), id);
	if (existsSync(nestedDir)) {
		rmSync(nestedDir, { recursive: true, force: true });
	}
	const legacyFlat = join(getModelsDir(), `${id}.onnx`);
	if (existsSync(legacyFlat)) {
		rmSync(legacyFlat, { force: true });
	}
}
