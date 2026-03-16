import { parseArgs } from "node:util";
import { createOnboardingRuntime } from "./app.js";
import { syncGoogleFormResponses } from "./google-form-sync.js";

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

if (!runtime.config.googleForm?.enabled) {
  console.error("googleForm.enabled must be true in config/services.json.");
  process.exit(1);
}

const summary = await syncGoogleFormResponses(
  {
    config: runtime.config.googleForm,
    env: runtime.env,
    providers: runtime.providers,
    defaultDryRun: runtime.env.defaultDryRun
  },
  values.dryRun
);

console.log(JSON.stringify(summary, null, 2));
