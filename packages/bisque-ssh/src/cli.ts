#!/usr/bin/env node
// Dev/test-only CLI entrypoint for Bisque with SSH tool routing enabled.
// Excluded from release builds (packages/bisque-ssh is omitted from root npm run build).

import { runBisqueCli } from "../../bisque/src/index.ts";
import { sshExtension } from "./ssh.ts";

process.title = "bisque-ssh";
void runBisqueCli(process.argv.slice(2), {
	additionalExtensions: [{ name: "bisque-ssh", factory: sshExtension, builtin: true }],
});
