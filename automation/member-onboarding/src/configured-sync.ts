import type { OnboardingConfig, GoogleFormConfig, GoogleDriveTarget } from "./config.js";
import type { AppEnv } from "./env.js";
import type { Provider } from "./types.js";
import { syncDriveTargetsFromEmailSheet, type DriveEmailSheetSyncSummary } from "./drive-email-sheet-sync.js";
import { syncGoogleFormResponses, type GoogleFormSyncSummary } from "./google-form-sync.js";

export type ConfiguredSyncSummary = {
  googleForm: GoogleFormSyncSummary;
  driveEmailSheet: DriveEmailSheetSyncSummary;
};

export async function runConfiguredSyncs(input: {
  config: OnboardingConfig;
  env: AppEnv;
  providers: Provider[];
}, forceDryRun?: boolean): Promise<ConfiguredSyncSummary> {
  const googleFormConfig = requireGoogleFormConfig(input.config.googleForm);

  const googleForm = await syncGoogleFormResponses(
    {
      config: googleFormConfig,
      env: input.env,
      providers: input.providers,
      defaultDryRun: input.env.defaultDryRun
    },
    forceDryRun
  );

  const driveEmailSheet = await syncDriveTargetsFromEmailSheet(
    {
      config: googleFormConfig,
      driveTargets: input.config.google.driveTargets,
      env: input.env,
      defaultDryRun: input.env.defaultDryRun
    },
    forceDryRun
  );

  return {
    googleForm,
    driveEmailSheet
  };
}

function requireGoogleFormConfig(
  config: GoogleFormConfig | undefined
): GoogleFormConfig {
  if (!config?.enabled) {
    throw new Error("googleForm.enabled must be true in config/services.json.");
  }

  return config;
}
