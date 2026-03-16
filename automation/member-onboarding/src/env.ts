import path from "node:path";
import { z } from "zod";

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    return value.toLowerCase() === "true";
  });

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  MEMBER_ONBOARDING_CONFIG: z.string().default("./config/services.json"),
  MEMBER_ONBOARDING_SECRET: z.string().min(1).optional(),
  DEFAULT_DRY_RUN: booleanish.default(false),
  SLACK_TOKEN: z.string().min(1).optional(),
  SLACK_TEAM_ID: z.string().min(1).optional(),
  SLACK_SCIM_BASE_URL: z.string().url().default("https://api.slack.com/scim/v2"),
  NOTION_TOKEN: z.string().min(1).optional(),
  NOTION_SCIM_BASE_URL: z
    .string()
    .url()
    .default("https://api.notion.com/scim/v2"),
  GOOGLE_IMPERSONATE_USER: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_FILE: z.string().min(1).optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  GOOGLE_FORM_SYNC_ENABLED: booleanish.default(false),
  GOOGLE_FORM_SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(60000)
});

export type AppEnv = {
  port: number;
  configPath: string;
  webhookSecret?: string | undefined;
  defaultDryRun: boolean;
  slackToken?: string | undefined;
  slackTeamId?: string | undefined;
  slackScimBaseUrl: string;
  notionToken?: string | undefined;
  notionScimBaseUrl: string;
  googleImpersonateUser?: string | undefined;
  googleServiceAccountFile?: string | undefined;
  googleServiceAccountJson?: string | undefined;
  googleFormSyncEnabled: boolean;
  googleFormSyncIntervalMs: number;
};

export function loadEnv(rawEnv: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.parse(rawEnv);

  return {
    port: parsed.PORT,
    configPath: path.resolve(parsed.MEMBER_ONBOARDING_CONFIG),
    webhookSecret: parsed.MEMBER_ONBOARDING_SECRET,
    defaultDryRun: parsed.DEFAULT_DRY_RUN,
    slackToken: parsed.SLACK_TOKEN,
    slackTeamId: parsed.SLACK_TEAM_ID,
    slackScimBaseUrl: parsed.SLACK_SCIM_BASE_URL.replace(/\/$/, ""),
    notionToken: parsed.NOTION_TOKEN,
    notionScimBaseUrl: parsed.NOTION_SCIM_BASE_URL.replace(/\/$/, ""),
    googleImpersonateUser: parsed.GOOGLE_IMPERSONATE_USER,
    googleServiceAccountFile: parsed.GOOGLE_SERVICE_ACCOUNT_FILE
      ? path.resolve(parsed.GOOGLE_SERVICE_ACCOUNT_FILE)
      : undefined,
    googleServiceAccountJson: parsed.GOOGLE_SERVICE_ACCOUNT_JSON,
    googleFormSyncEnabled: parsed.GOOGLE_FORM_SYNC_ENABLED,
    googleFormSyncIntervalMs: parsed.GOOGLE_FORM_SYNC_INTERVAL_MS
  };
}
