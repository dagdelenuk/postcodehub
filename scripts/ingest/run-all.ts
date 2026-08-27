import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logStep } from "./lib/fetch-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Order matters: geography seeds the outcode list every other script joins
// against, and build-outcode-data must run last to merge everything.
const STEPS = [
  "fetch-geography.ts",
  "fetch-health.ts",
  "fetch-schools.ts",
  "fetch-crime.ts",
  "fetch-property.ts",
  "fetch-representatives.ts",
  "fetch-planning.ts",
  "seed-places-events-history.ts",
  "fetch-banner-images.ts",
  "build-outcode-data.ts",
];

function runStep(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["tsx", path.join(__dirname, script)], { stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} exited with code ${code}`))));
  });
}

async function main() {
  const start = Date.now();
  for (const step of STEPS) {
    logStep("run-all", `=== ${step} ===`);
    await runStep(step);
  }
  logStep("run-all", `Pipeline complete in ${((Date.now() - start) / 1000).toFixed(1)}s.`);
}

main().catch((err) => {
  console.error("[run-all] FAILED:", err);
  process.exit(1);
});
