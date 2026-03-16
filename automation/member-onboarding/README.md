# Member Onboarding Automation

This service receives a new member profile and fans out onboarding actions across the Surfers stack.

## What it covers

- Slack workspace onboarding
- Notion workspace provisioning
- Google Groups membership
- Google Drive or Shared Drive access

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
2. The service validates the member payload.
3. Each provider runs independently and returns `success`, `failed`, `skipped`, or `dry_run`.
4. The response includes a single execution summary you can store in your upstream system.

## Files

- `src/index.ts`: HTTP server entrypoint
- `src/cli.ts`: manual replay command for one member
- `config/services.example.json`: versioned example for non-secret target configuration
- `.env.example`: secret and runtime configuration example

## Setup

1. Install dependencies.
2. Copy `.env.example` to `.env`.
3. Copy `config/services.example.json` to `config/services.json`.
4. Fill in the provider tokens, IDs, and Google service account settings.
5. Start the server with `pnpm serve`.

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
