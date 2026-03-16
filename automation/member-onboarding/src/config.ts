import { readFile } from "node:fs/promises";
import { z } from "zod";

const slackConfigSchema = z.object({
  mode: z.enum(["disabled", "scim", "admin"]).default("disabled"),
  defaultChannels: z.array(z.string().min(1)).default([]),
  customMessage: z.string().min(1).optional()
});

const notionConfigSchema = z.object({
  mode: z.enum(["disabled", "scim"]).default("disabled"),
  role: z
    .enum(["owner", "membership_admin", "member", "restricted_member"])
    .default("member")
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

const onboardingConfigSchema = z.object({
  slack: slackConfigSchema.default({ mode: "disabled", defaultChannels: [] }),
  notion: notionConfigSchema.default({ mode: "disabled", role: "member" }),
  google: z
    .object({
      groups: z.array(googleGroupSchema).default([]),
      driveTargets: z.array(googleDriveTargetSchema).default([])
    })
    .default({ groups: [], driveTargets: [] })
});

export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;
export type GoogleGroupTarget = z.infer<typeof googleGroupSchema>;
export type GoogleDriveTarget = z.infer<typeof googleDriveTargetSchema>;

export async function loadConfig(configPath: string): Promise<OnboardingConfig> {
  const file = await readFile(configPath, "utf8");
  const json = JSON.parse(file) as unknown;
  return onboardingConfigSchema.parse(json);
}
