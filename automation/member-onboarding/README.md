# Member Onboarding Automation

This service receives a new member profile and fans out onboarding actions across the Surfers stack.

## What it covers

- Slack workspace onboarding
- Notion workspace provisioning
- Google Groups membership
- Google Drive or Shared Drive access
- Google Form response sheet ingestion

KakaoTalk is intentionally excluded because it is not reliably automatable with an official admin API.

## Service support matrix

| Service | Status | Notes |
| --- | --- | --- |
| Slack | Supported with caveats | `scim` mode needs a Slack `Business+` or `Enterprise Grid` plan. `admin` mode needs `Enterprise Grid` and at least one channel ID. |
| Notion | Supported with caveats | Requires Notion `Enterprise` with SCIM enabled. |
| Google Groups | Supported | Requires a Google Workspace service account with domain-wide delegation. |
| Google Drive | Supported | Requires a Google Workspace service account with domain-wide delegation. |

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
- `GOOGLE_IMPERSONATE_USER`
- `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_SERVICE_ACCOUNT_JSON`
- `GOOGLE_FORM_SYNC_ENABLED`
- `GOOGLE_FORM_SYNC_INTERVAL_MS`

### `config/services.json`

Use `config/services.json` for non-secret operational settings:

- Slack mode and default channel IDs
- Notion role
- Google Group emails and Drive target IDs
- Google Form spreadsheet ID, sheet name, and header names

## Required credentials

### Slack

- `SLACK_TOKEN`
- `SLACK_TEAM_ID` only for `admin` mode

`scim` mode provisions the user account through SCIM. `admin` mode sends a workspace invitation email and joins the user to the configured channels.

### Notion

- `NOTION_TOKEN`

The token must be a SCIM token created from Notion organization settings.

### Google Workspace

- `GOOGLE_IMPERSONATE_USER`
- Either `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_SERVICE_ACCOUNT_JSON`

The service account must be granted domain-wide delegation for:

- `https://www.googleapis.com/auth/admin.directory.group.member`
- `https://www.googleapis.com/auth/drive`
- `https://www.googleapis.com/auth/spreadsheets`

If you use Google Form syncing, the impersonated user must also be able to read and edit the response spreadsheet.

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

### Trigger Google Form sync over HTTP

```bash
curl -X POST http://localhost:8787/sync/google-form \
  -H "content-type: application/json" \
  -H "x-surfers-secret: change-me" \
  -d '{"dryRun": true}'
```

If `GOOGLE_FORM_SYNC_ENABLED=true`, the server also polls the configured sheet automatically on the configured interval.

## Google Form sheet expectations

The sync reads one response row at a time and looks for the configured header names.

Required headers:

- the column named by `googleForm.emailColumn`

Optional headers:

- `googleForm.fullNameColumn`
- `googleForm.givenNameColumn`
- `googleForm.familyNameColumn`
- `googleForm.slackUserNameColumn`

Output headers:

- `googleForm.statusColumn`
- `googleForm.processedAtColumn`
- `googleForm.resultColumn`

If the output headers do not exist yet, the sync creates them in the header row automatically.

Rows are processed only when:

- the email cell is not empty
- the status cell is empty

Once a row is attempted, the sync writes back the result so it will not be retried unless you clear the status cell.

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
- [Notion SCIM setup](https://www.notion.com/help/set-up-identity-provider-for-scim)
- [Notion SCIM user provisioning](https://www.notion.com/help/provision-users-and-groups-with-scim)
- [Google Admin SDK members.insert](https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/insert)
- [Google Drive permissions.create](https://developers.google.com/drive/api/reference/rest/v3/permissions/create)
- [Google Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Google Sheets values.batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchUpdate)
