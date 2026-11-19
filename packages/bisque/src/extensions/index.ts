// Bisque extension registry. Every Bisque feature is an extension loaded here.
// Order matters: foundational gates (prompt-guard, paths, permission) register
// before higher-level shell, goal, status, safety, config-tools, and commands.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { shellExtension } from "../shell.ts";
import { commandsExtension } from "./commands.ts";
import { configToolsExtension } from "./config-tools.ts";
import { goalExtension } from "./goal.ts";
import { pathsExtension } from "./paths.ts";
import { permissionExtension } from "./permission.ts";
import { promptGuardExtension } from "./prompt-guard.ts";
import { safetyExtension } from "./safety.ts";
import { statusExtension } from "./status.ts";

export const bisqueExtensions: Array<{
	name: string;
	factory: (pi: ExtensionAPI) => void;
	builtin: boolean;
}> = [
	{ name: "bisque-prompt-guard", factory: promptGuardExtension, builtin: true },
	{ name: "bisque-paths", factory: pathsExtension, builtin: true },
	{ name: "bisque-permission", factory: permissionExtension, builtin: true },
	{ name: "bisque-shell", factory: shellExtension, builtin: true },
	{ name: "bisque-goal", factory: goalExtension, builtin: true },
	{ name: "bisque-status", factory: statusExtension, builtin: true },
	{ name: "bisque-safety", factory: safetyExtension, builtin: true },
	{ name: "bisque-config-tools", factory: configToolsExtension, builtin: true },
	{ name: "bisque-commands", factory: commandsExtension, builtin: true },
];

export function registerBisqueExtensions(pi: ExtensionAPI): void {
	for (const ext of bisqueExtensions) {
		ext.factory(pi);
	}
}
