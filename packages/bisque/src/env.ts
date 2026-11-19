// Environment loader for Bisque CLI. Loads a local .env file without overriding
// existing process environment variables and normalizes provider key aliases.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function parseDotEnv(raw: string): Record<string, string> {
	const parsed: Record<string, string> = {};
	for (const rawLine of raw.split(/\r?\n/)) {
		const trimmed = rawLine.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const line = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
		const eqIndex = line.indexOf("=");
		if (eqIndex <= 0) continue;

		const key = line.slice(0, eqIndex).trim();
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

		let value = line.slice(eqIndex + 1).trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		} else {
			const commentIndex = value.indexOf(" #");
			if (commentIndex !== -1) {
				value = value.slice(0, commentIndex).trim();
			}
		}

		if (value.length > 0) {
			parsed[key] = value;
		}
	}
	return parsed;
}

export function loadDotEnv(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
	const loadedKeys: string[] = [];
	const envPath = join(cwd, ".env");

	if (existsSync(envPath)) {
		const entries = parseDotEnv(readFileSync(envPath, "utf-8"));
		for (const [key, value] of Object.entries(entries)) {
			if (env[key] === undefined) {
				env[key] = value;
				loadedKeys.push(key);
			}
		}
	}

	// pi-ai's Google provider reads GEMINI_API_KEY; mirror GOOGLE_API_KEY when GEMINI_API_KEY is unset.
	if (env.GEMINI_API_KEY === undefined && env.GOOGLE_API_KEY) {
		env.GEMINI_API_KEY = env.GOOGLE_API_KEY;
		loadedKeys.push("GEMINI_API_KEY");
	}

	return loadedKeys;
}
