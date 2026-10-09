#!/usr/bin/env node
// Runs the TypeScript entry through tsx so no build step is needed.
// The tsconfig is pinned so JSX compiles the same from any working directory.
import { register } from "tsx/esm/api";
import { fileURLToPath } from "node:url";

register({ tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)) });
await import("../src/cli.tsx");
