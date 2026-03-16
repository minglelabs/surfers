import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSlackUserName,
  normalizeMember,
  summarizeResults
} from "./orchestrator.js";

test("normalizeMember normalizes email and builds a name fallback", () => {
  const member = normalizeMember({
    email: " TeSt@Example.com "
  });

  assert.equal(member.email, "test@example.com");
  assert.equal(member.fullName, "test");
  assert.match(member.slackUserName, /^test-[a-f0-9]{4}$/);
});

test("buildSlackUserName creates a bounded identifier", () => {
  const userName = buildSlackUserName(
    "very.long.member.email@example.com",
    "Very Long Member Name"
  );

  assert.ok(userName.length <= 21);
  assert.match(userName, /^[a-z0-9._-]+$/);
});

test("summarizeResults reports partial failures", () => {
  const summary = summarizeResults([
    {
      provider: "slack",
      target: "workspace",
      status: "success",
      message: "ok"
    },
    {
      provider: "google-drive",
      target: "drive",
      status: "failed",
      message: "nope"
    }
  ]);

  assert.equal(summary, "partial_failure");
});
