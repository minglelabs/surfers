import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMemberRequest,
  columnNumberToLetter
} from "./google-form-sync.js";

test("columnNumberToLetter converts numeric indexes to A1 letters", () => {
  assert.equal(columnNumberToLetter(1), "A");
  assert.equal(columnNumberToLetter(26), "Z");
  assert.equal(columnNumberToLetter(27), "AA");
  assert.equal(columnNumberToLetter(52), "AZ");
});

test("buildMemberRequest maps configured headers into a member payload", () => {
  const member = buildMemberRequest(
    [
      "2026-03-16 18:00:00",
      "member@example.com",
      "Member Name",
      "member-name",
      "C"
    ],
    {
      Timestamp: 0,
      "Email Address": 1,
      Name: 2,
      "Slack Username": 3,
      조: 4
    },
    {
      enabled: true,
      spreadsheetId: "sheet-id",
      sheetName: "Form Responses 1",
      headerRow: 1,
      emailColumn: "Email Address",
      fullNameColumn: "Name",
      slackUserNameColumn: "Slack Username",
      groupColumn: "조",
      statusColumn: "Automation Status",
      processedAtColumn: "Automation Processed At",
      resultColumn: "Automation Result",
      sourceLabel: "google-form"
    }
  );

  assert.deepEqual(member, {
    email: "member@example.com",
    fullName: "Member Name",
    givenName: undefined,
    familyName: undefined,
    slackUserName: "member-name",
    source: "google-form",
    metadata: {
      group: "C"
    }
  });
});
