#!/usr/bin/env node
// Production CLI entrypoint for Bisque.
// Excludes build-flagged SSH extensions; only standard local Bisque extensions are loaded.

import { runBisqueCli } from "./index.ts";

process.title = "bisque";
void runBisqueCli(process.argv.slice(2));
