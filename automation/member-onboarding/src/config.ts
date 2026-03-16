import { readFile } from "node:fs/promises";
import { z } from "zod";

const slackConfigSchema = z.object({
  mode: z.enum(["disabled", "scim", "admin"]).default("disabled"),
  defaultChannels: z.array(z.string().min(1)).default([]),
  customMessage: z.string().min(1).optional()
});

const notionDatabaseConfigSchema = z.object({
  databaseId: z.string().min(1),
  titleProperty: z.string().min(1).default("이름"),
  introProperty: z.string().min(1).default("소개"),
  goalProperty: z.string().min(1).default("3개월간 목표"),
  groupProperty: z.string().min(1).default("조"),
  presentationProperty: z.string().min(1).default("발제"),
  defaultIntro: z.string().default(""),
  defaultGoal: z.string().default(""),
  defaultPresentation: z.boolean().default(false)
});

const notionConfigSchema = z.object({
  mode: z.enum(["disabled", "scim", "database"]).default("disabled"),
  role: z
    .enum(["owner", "membership_admin", "member", "restricted_member"])
    .default("member"),
  database: notionDatabaseConfigSchema.optional()
});

const googleGroupSchema = z.object({
  email: z.string().email(),
  role: z.enum(["MEMBER", "MANAGER", "OWNER"]).default("MEMBER")
});

const googleDriveTargetSchema = z.object({
  label: z.string().min(1).optional(),
  fileId: z.string().min(1),
  role: z
    .enum(["reader", "commenter", "writer", "fileOrganizer", "organizer"])
    .default("reader"),
  sendNotificationEmail: z.boolean().default(true),
  emailMessage: z.string().min(1).optional(),
  useDomainAdminAccess: z.boolean().default(false)
});

const googleFormConfigSchema = z.object({
  enabled: z.boolean().default(false),
  spreadsheetId: z.string().min(1),
  sheetName: z.string().min(1).default("Form Responses 1"),
  headerRow: z.number().int().positive().default(1),
  emailColumn: z.string().min(1),
  fullNameColumn: z.string().min(1).optional(),
  givenNameColumn: z.string().min(1).optional(),
  familyNameColumn: z.string().min(1).optional(),
  slackUserNameColumn: z.string().min(1).optional(),
  groupColumn: z.string().min(1).optional(),
  paymentStatusColumn: z.string().min(1).optional(),
  paymentStatusIncludes: z.string().min(1).optional(),
  paymentAmountColumn: z.string().min(1).optional(),
  statusColumn: z.string().min(1).default("Automation Status"),
  processedAtColumn: z.string().min(1).default("Automation Processed At"),
  resultColumn: z.string().min(1).default("Automation Result"),
  sourceLabel: z.string().min(1).default("google-form")
});

const onboardingConfigSchema = z.object({
  slack: slackConfigSchema.default({ mode: "disabled", defaultChannels: [] }),
  notion: notionConfigSchema.default({ mode: "disabled", role: "member" }),
  google: z
    .object({
      groups: z.array(googleGroupSchema).default([]),
      driveTargets: z.array(googleDriveTargetSchema).default([])
    })
    .default({ groups: [], driveTargets: [] }),
  googleForm: googleFormConfigSchema.optional()
});

export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;
export type GoogleGroupTarget = z.infer<typeof googleGroupSchema>;
export type GoogleDriveTarget = z.infer<typeof googleDriveTargetSchema>;
export type GoogleFormConfig = z.infer<typeof googleFormConfigSchema>;

export async function loadConfig(configPath: string): Promise<OnboardingConfig> {
  const file = await readFile(configPath, "utf8");
  const json = JSON.parse(file) as unknown;
  return onboardingConfigSchema.parse(json);
}
