# Member Onboarding Automation

This service receives a new member profile and fans out onboarding actions across the Surfers stack.

## What it covers

- Slack workspace onboarding
- Notion workspace provisioning or member database writes
- Google Groups membership
- Google Drive or Shared Drive access
- Google Form response sheet ingestion

KakaoTalk is intentionally excluded because it is not reliably automatable with an official admin API.

## Service support matrix

| Service | Status | Notes |
| --- | --- | --- |
| Slack | Supported with caveats | `scim` mode needs a Slack `Business+` or `Enterprise Grid` plan. `admin` mode needs `Enterprise Grid` and at least one channel ID. |
| Notion | Supported with caveats | `database` mode works with a regular internal integration token and a shared page tree. `scim` mode requires Notion `Enterprise`. |
| Google Groups | Workspace only | Requires a Google Workspace service account with domain-wide delegation. Personal Gmail is not supported. |
| Google Drive | Supported | Works with a service account directly. Share the target file or folder with the service account email. |
| Google Sheets / Google Form sync | Supported | Works with a service account directly. Share the response spreadsheet with the service account email. |

## How it works

1. A signup flow, Airtable automation, Form backend, Zapier step, or internal admin tool sends a `POST /members/onboard` request.
2. Or, a Google Form response sheet is polled and new rows are converted into onboarding requests automatically.
3. The service validates the member payload.
4. Each provider runs independently and returns `success`, `failed`, `skipped`, or `dry_run`.
5. The response includes a single execution summary you can store in your upstream system.

## Files

- `src/index.ts`: HTTP server entrypoint
- `src/cli.ts`: manual replay command for one member
- `src/sync-google-form.ts`: manual sync command for one Google Form response sheet
- `src/sync-drive-sheet.ts`: manual backfill command for Drive permissions from the mirrored email sheet
- `config/services.example.json`: versioned example for non-secret target configuration
- `.env.example`: secret and runtime configuration example

## Setup

1. Install dependencies.
2. Copy `.env.example` to `.env` in this directory.
3. Copy `config/services.example.json` to `config/services.json`.
4. Fill in the provider tokens, IDs, Google Form sheet mapping, and Google service account settings.
5. Start the server with `pnpm serve`.

## What goes where

### `.env`

Use `.env` for secrets and runtime switches:

- `MEMBER_ONBOARDING_SECRET`
- `SLACK_TOKEN`
- `SLACK_TEAM_ID` only when using Slack `admin` mode
- `NOTION_TOKEN`
- `NOTION_API_TOKEN`
- `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_IMPERSONATE_USER` only when using Google Groups with Google Workspace
- `GOOGLE_FORM_SYNC_ENABLED`
- `GOOGLE_FORM_SYNC_INTERVAL_MS`

### `config/services.json`

Use `config/services.json` for non-secret operational settings:

- Slack mode and default channel IDs
- Notion role or database property mapping
- Google Group emails and Drive target IDs
- Google Form spreadsheet ID, sheet name, header names, and mirror sheet names

## Required credentials

### Slack

- `SLACK_TOKEN`
- `SLACK_TEAM_ID` only for `admin` mode

`scim` mode provisions the user account through SCIM. `admin` mode sends a workspace invitation email and joins the user to the configured channels.

### Notion

- `NOTION_API_TOKEN` for `database` mode
- `NOTION_TOKEN` for `scim` mode

`database` mode uses a regular internal integration token from the Notion integrations dashboard. Share the target parent page or database with that integration through `... -> Add connections`.

`scim` mode requires a SCIM token created from Notion organization settings.

### Google Workspace

- Either `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_IMPERSONATE_USER` only for Google Groups or other Google Workspace admin actions

For personal Gmail or non-admin use cases:

- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`

Share the Google Form response spreadsheet and any Drive file or folder targets directly with the service account email from your JSON key.

For Google Workspace group automation:

- the service account must be granted domain-wide delegation
- `GOOGLE_IMPERSONATE_USER` must be set to an admin user
- `https://www.googleapis.com/auth/admin.directory.group.member` must be authorized

If you use Google Form syncing, the service account must be able to read and edit the response spreadsheet.

## API

### Health check

```bash
curl http://localhost:8787/health
```

### Onboard a member

```bash
curl -X POST http://localhost:8787/members/onboard \
  -H "content-type: application/json" \
  -H "x-surfers-secret: change-me" \
  -d '{
    "email": "new-member@example.com",
    "fullName": "New Member",
    "source": "airtable"
  }'
```

Payload fields:

- `email` required
- `fullName` optional
- `givenName` optional
- `familyName` optional
- `slackUserName` optional, useful when you want to pin the Slack SCIM username
- `source` optional
- `dryRun` optional
- `metadata` optional string map

### CLI replay

```bash
pnpm onboard -- --email new-member@example.com --name "New Member"
pnpm onboard -- --email new-member@example.com --name "New Member" --dry-run
```

### Sync Google Form responses once

```bash
pnpm sync:form -- --dry-run
pnpm sync:form
```

`sync:form` now also backfills Google Drive permissions for every unique email in the configured `googleForm.emailSheetName`.

### Sync Drive permissions from the mirrored email sheet

```bash
pnpm sync:drive-sheet -- --dry-run
pnpm sync:drive-sheet
```

### Trigger Google Form sync over HTTP

```bash
curl -X POST http://localhost:8787/sync/google-form \
  -H "content-type: application/json" \
  -H "x-surfers-secret: change-me" \
  -d '{"dryRun": true}'
```

If `GOOGLE_FORM_SYNC_ENABLED=true`, the server also polls the configured sheet automatically on the configured interval.

## Personal Gmail setup

If you are not using Google Workspace admin APIs:

1. Create a Google Cloud service account and download its JSON key.
2. Put the JSON file on disk and set `GOOGLE_SERVICE_ACCOUNT_FILE` in `.env`.
3. Open the JSON file and copy the `client_email` value.
4. Share your Google Form response spreadsheet with that service account email as an editor.
5. Share the Drive folder or file you want to grant access to with that same service account email.
6. Leave `GOOGLE_IMPERSONATE_USER` empty.

Google Groups invites will be skipped automatically in this mode.

## Google Form sheet expectations

The sync reads one response row at a time and looks for the configured header names.

Required headers:

- the column named by `googleForm.emailColumn`

Optional headers:

- `googleForm.fullNameColumn`
- `googleForm.givenNameColumn`
- `googleForm.familyNameColumn`
- `googleForm.slackUserNameColumn`
- `googleForm.groupColumn`
- `googleForm.paymentStatusColumn`
- `googleForm.paymentAmountColumn`
- `googleForm.phoneSourceColumn`
- `googleForm.emailSourceColumn`

Output headers:

- `googleForm.statusColumn`
- `googleForm.processedAtColumn`
- `googleForm.resultColumn`

If the output headers do not exist yet, the sync creates them in the header row automatically.

Rows are processed only when:

- the email cell is not empty
- the configured group cell is not empty
- the configured payment status cell includes the configured accepted text
- the configured payment amount cell is not empty
- the status cell is empty

Once a row is attempted, the sync writes back the result so it will not be retried unless you clear the status cell.

If `googleForm.phoneSourceColumn` is configured, the sync also mirrors `[name, phone]` rows into `googleForm.phoneSheetName`.

If `googleForm.emailSourceColumn` is configured, the sync extracts one or more email addresses from the source cell and mirrors `[name, email]` rows into `googleForm.emailSheetName`. Cells with two emails create two rows automatically.

If `google.driveTargets` is configured, the Drive sync reads every unique email from `googleForm.emailSheetName` and grants the configured Drive role to that email address. This is useful when one member has two separate emails that both need folder access.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

## Official docs

- [Slack SCIM](https://api.slack.com/admins/scim2)
- [Slack admin.users.invite](https://api.slack.com/methods/admin.users.invite)
- [Slack managing users](https://docs.slack.dev/admins/managing-users/)
- [Notion internal integration setup](https://developers.notion.com/docs/create-a-notion-integration)
- [Notion authorization](https://developers.notion.com/docs/authorization)
- [Notion create a page](https://developers.notion.com/reference/post-page)
- [Notion SCIM setup](https://www.notion.com/help/set-up-identity-provider-for-scim)
- [Notion SCIM user provisioning](https://www.notion.com/help/provision-users-and-groups-with-scim)
- [Google Admin SDK members.insert](https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/insert)
- [Google Drive permissions.create](https://developers.google.com/drive/api/reference/rest/v3/permissions/create)
- [Google Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Google Sheets values.batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate)
