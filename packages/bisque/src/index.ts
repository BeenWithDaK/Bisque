// Public entry point for @earendil-works/bisque.
// Side-effect-free library surface; CLI execution lives in ./cli.ts.

import { type InlineExtension, type MainOptions, main } from "@earendil-works/pi-coding-agent";
import { loadDotEnv } from "./env.ts";
import { bisqueExtensions } from "./extensions/index.ts";

export { ansi256, BISQUE_COLORS } from "./brand.ts";
export { loadDotEnv, parseDotEnv } from "./env.ts";
export { commandsExtension } from "./extensions/commands.ts";
export { configToolsExtension, isRestrictedSetting } from "./extensions/config-tools.ts";
export {
	GOAL_WIDGET_KEY,
	type GoalReview,
	type GoalState,
	getActiveGoal,
	getPendingGoalReview,
	goalExtension,
	handleGoalCommand,
	renderGoalBubble,
} from "./extensions/goal.ts";
export { bisqueExtensions, registerBisqueExtensions } from "./extensions/index.ts";
export {
	type GrantedFolder,
	getGrantedFolders,
	handleFoldersCommand,
	isPathGranted,
	pathsExtension,
} from "./extensions/paths.ts";
export {
	CONFIRM_MODES,
	type ConfirmMode,
	getConfirmMode,
	getDecisionModel,
	handleModeCommand,
	permissionExtension,
	setDecisionModel,
} from "./extensions/permission.ts";
export { getPromptGuard, promptGuardExtension, setPromptGuard } from "./extensions/prompt-guard.ts";
export {
	configureSafetyRuntime,
	formatSafetyStatus,
	getSafetyCatalog,
	handleSafetyCommand,
	safetyExtension,
} from "./extensions/safety.ts";
export {
	DEFAULT_USAGE_LIMITS,
	FIVE_HOURS_MS,
	formatContextRemaining,
	formatUsageRemaining,
	getUsageLimits,
	getUsageSnapshot,
	recordUsage,
	refreshStatusBar,
	renderStatusBar,
	SEVEN_DAYS_MS,
	STATUS_WIDGET_KEY,
	setUsageLimits,
	statusExtension,
	type UsageLedgerEntry,
	type UsageLimits,
	type UsageSnapshot,
} from "./extensions/status.ts";
export {
	type ClassifierRunner,
	type DecisionClassification,
	type DecisionModel,
	OnnxDecisionModel,
	OnnxPromptGuard,
	type PipelineLoader,
	type PromptGuard,
	type PromptGuardClassification,
} from "./models/runner.ts";
export {
	computeSha256,
	DEFAULT_MODEL_MANIFEST,
	ensureModelsDir,
	getModelsDir,
	type InstallModelOptions,
	installModelWeights,
	isInstalled,
	type LocalModelId,
	loadModelCatalog,
	type ModelArtifactSpec,
	type ModelManifestEntry,
	modelPath,
	readManifest,
	removeModelWeights,
	saveModelCatalog,
	writeManifest,
} from "./models/storage.ts";
export {
	BISQUE_PROMPTS_DIR,
	BISQUE_SKILLS_DIR,
	BISQUE_VERSION,
	BisqueEditor,
	getBisquePromptPrefix,
	renderBisqueHeaderLines,
	renderBisqueSplash,
	shellExtension,
} from "./shell.ts";
export { ensureBisqueDir, getBisqueDir, readJson, writeJson } from "./storage.ts";

export interface RunBisqueOptions {
	cwd?: string;
	additionalExtensions?: InlineExtension[];
}

export async function runBisqueCli(
	args: string[] = process.argv.slice(2),
	options: RunBisqueOptions = {},
): Promise<void> {
	loadDotEnv(options.cwd ?? process.cwd());

	const extensions: InlineExtension[] = [
		...bisqueExtensions.map((ext) => ({
			name: ext.name,
			factory: ext.factory,
			builtin: ext.builtin,
		})),
		...(options.additionalExtensions ?? []),
	];

	const mainOptions: MainOptions = {
		extensionFactories: extensions,
	};

	await main(args, mainOptions);
}
