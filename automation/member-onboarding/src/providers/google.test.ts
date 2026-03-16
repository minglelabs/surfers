import test from "node:test";
import assert from "node:assert/strict";
import { GoogleProvider } from "./google.js";

test("GoogleProvider skips group automation when no workspace impersonation is configured", async () => {
  const provider = new GoogleProvider(
    {
      groups: [{ email: "members@example.com", role: "MEMBER" }],
      driveTargets: []
    },
    {
      port: 8787,
      configPath: "/tmp/services.json",
      defaultDryRun: false,
      slackScimBaseUrl: "https://api.slack.com/scim/v2",
      notionScimBaseUrl: "https://api.notion.com/scim/v2",
      googleFormSyncEnabled: false,
      googleFormSyncIntervalMs: 60000
    }
  );

  const results = await provider.onboard(
    {
      email: "member@example.com",
      fullName: "Member Example",
      slackUserName: "member-example"
    },
    {
      executionId: "test",
      dryRun: false,
      startedAt: new Date().toISOString()
    }
  );

  assert.deepEqual(results, [
    {
      provider: "google-groups",
      target: "members@example.com",
      status: "skipped",
      message:
        "Google Groups automation requires GOOGLE_IMPERSONATE_USER and a Google Workspace domain."
    }
  ]);
});
