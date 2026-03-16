import { parseArgs } from "node:util";
import { createOnboardingRuntime } from "./app.js";
import { runConfiguredSyncs } from "./configured-sync.js";

const { values } = parseArgs({
  args: process.argv
    .slice(2)
    .filter((argument) => argument !== "--")
    .map((argument) => (argument === "--dry-run" ? "--dryRun" : argument)),
  options: {
    dryRun: { type: "boolean" },
    help: { type: "boolean" }
  }
});

if (values.help) {
  console.log("Usage:\n\npnpm sync:form -- --dry-run\n");
  process.exit(0);
}

const runtime = await createOnboardingRuntime();
const summary = await runConfiguredSyncs(runtime, values.dryRun);

console.log(JSON.stringify(summary, null, 2));
