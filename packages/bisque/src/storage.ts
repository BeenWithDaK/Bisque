// Atomic JSON file storage for Bisque extension state under <agentDir>/bisque/.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export function getBisqueDir(): string {
	return join(getAgentDir(), "bisque");
}

export function ensureBisqueDir(): string {
	const dir = getBisqueDir();
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export function readJson<T>(fileName: string, fallback: T): T {
	const path = join(getBisqueDir(), fileName);
	if (!existsSync(path)) return fallback;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch {
		return fallback;
	}
}

export function writeJson<T>(fileName: string, data: T): void {
	const dir = ensureBisqueDir();
	const path = join(dir, fileName);
	const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
	renameSync(tmpPath, path);
}
