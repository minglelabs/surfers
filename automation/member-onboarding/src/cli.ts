import { parseArgs } from "node:util";
import { createOnboardingRuntime } from "./app.js";
import { runMemberOnboarding } from "./orchestrator.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((argument) => argument !== "--"),
  options: {
    email: { type: "string" },
    name: { type: "string" },
    givenName: { type: "string" },
    familyName: { type: "string" },
    slackUserName: { type: "string" },
    source: { type: "string" },
    dryRun: { type: "boolean" },
    help: { type: "boolean" }
  }
});

if (values.help || !values.email) {
  printUsage();
  process.exit(values.help ? 0 : 1);
}

const runtime = await createOnboardingRuntime();
const result = await runMemberOnboarding({
  memberInput: {
    email: values.email,
    fullName: values.name,
    givenName: values.givenName,
    familyName: values.familyName,
    slackUserName: values.slackUserName,
    source: values.source,
    dryRun: values.dryRun
  },
  defaultDryRun: runtime.env.defaultDryRun,
  providers: runtime.providers
});

console.log(JSON.stringify(result, null, 2));

function printUsage(): void {
  console.log(`Usage:

pnpm onboard -- --email member@example.com --name "Member Name"
pnpm onboard -- --email member@example.com --givenName Jane --familyName Doe --dry-run
`);
}
