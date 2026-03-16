import type { GoogleDriveTarget, GoogleFormConfig } from "./config.js";
import type { AppEnv } from "./env.js";
import { getGoogleAccessToken } from "./google-auth.js";
import { fetchJson, getErrorMessage, HttpError } from "./http.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

type SheetValuesResponse = {
  values?: string[][];
};

type DrivePermissionsList = {
  permissions?: Array<{
    id: string;
    emailAddress?: string;
    role?: string;
  }>;
};

type EmailSheetEntry = {
  name: string;
  email: string;
};

export type DriveEmailSheetSyncSummary = {
  source: string;
  dryRun: boolean;
  scannedRows: number;
  uniqueEmails: number;
  targets: Array<{
    target: string;
    granted: number;
    skipped: number;
    failed: number;
  }>;
  rows: Array<{
    name: string;
    email: string;
    target: string;
    status: "success" | "failed" | "skipped" | "dry_run";
    message: string;
  }>;
};

export async function syncDriveTargetsFromEmailSheet(input: {
  config: GoogleFormConfig;
  driveTargets: GoogleDriveTarget[];
  env: AppEnv;
  defaultDryRun: boolean;
}, forceDryRun?: boolean): Promise<DriveEmailSheetSyncSummary> {
  const effectiveDryRun = forceDryRun ?? input.defaultDryRun;
  const entries = await readEmailSheetEntries(input.env, input.config);

  if (input.driveTargets.length === 0) {
    return {
      source: `${input.config.spreadsheetId}/${input.config.emailSheetName}`,
      dryRun: effectiveDryRun,
      scannedRows: entries.scannedRows,
      uniqueEmails: entries.rows.length,
      targets: [],
      rows: []
    };
  }

  if (entries.rows.length === 0) {
    return {
      source: `${input.config.spreadsheetId}/${input.config.emailSheetName}`,
      dryRun: effectiveDryRun,
      scannedRows: entries.scannedRows,
      uniqueEmails: 0,
      targets: input.driveTargets.map((target) => ({
        target: target.label ?? target.fileId,
        granted: 0,
        skipped: 0,
        failed: 0
      })),
      rows: []
    };
  }

  const driveAccessToken = await getGoogleAccessToken(input.env, [DRIVE_SCOPE]);
  const summaryRows: DriveEmailSheetSyncSummary["rows"] = [];
  const targetSummaries: DriveEmailSheetSyncSummary["targets"] = [];

  for (const target of input.driveTargets) {
    const targetName = target.label ?? target.fileId;
    const counters = {
      target: targetName,
      granted: 0,
      skipped: 0,
      failed: 0
    };

    let existingPermissions = new Map<string, string>();

    try {
      existingPermissions = await listExistingPermissions(driveAccessToken, target);
    } catch (error) {
      const message = getErrorMessage(error);
      counters.failed = entries.rows.length;
      for (const entry of entries.rows) {
        summaryRows.push({
          name: entry.name,
          email: entry.email,
          target: targetName,
          status: "failed",
          message
        });
      }
      targetSummaries.push(counters);
      continue;
    }

    for (const entry of entries.rows) {
      const existingRole = existingPermissions.get(entry.email);

      if (existingRole) {
        counters.skipped += 1;
        summaryRows.push({
          name: entry.name,
          email: entry.email,
          target: targetName,
          status: "skipped",
          message: `${entry.email} already has ${existingRole} access.`
        });
        continue;
      }

      if (effectiveDryRun) {
        counters.skipped += 1;
        summaryRows.push({
          name: entry.name,
          email: entry.email,
          target: targetName,
          status: "dry_run",
          message: `Would grant ${target.role} access to ${entry.email}.`
        });
        continue;
      }

      try {
        await createPermission(driveAccessToken, target, entry.email);
        existingPermissions.set(entry.email, target.role);
        counters.granted += 1;
        summaryRows.push({
          name: entry.name,
          email: entry.email,
          target: targetName,
          status: "success",
          message: `Granted ${target.role} access to ${entry.email}.`
        });
      } catch (error) {
        counters.failed += 1;
        summaryRows.push({
          name: entry.name,
          email: entry.email,
          target: targetName,
          status: "failed",
          message: getErrorMessage(error)
        });
      }
    }

    targetSummaries.push(counters);
  }

  return {
    source: `${input.config.spreadsheetId}/${input.config.emailSheetName}`,
    dryRun: effectiveDryRun,
    scannedRows: entries.scannedRows,
    uniqueEmails: entries.rows.length,
    targets: targetSummaries,
    rows: summaryRows
  };
}

async function readEmailSheetEntries(
  env: AppEnv,
  config: GoogleFormConfig
): Promise<{ scannedRows: number; rows: EmailSheetEntry[] }> {
  const sheetsAccessToken = await getGoogleAccessToken(env, [SHEETS_SCOPE]);
  const values = await readSheetValues(
    sheetsAccessToken,
    config.spreadsheetId,
    config.emailSheetName
  );

  const rows = values
    .map((row) => ({
      name: (row[0] ?? "").trim(),
      email: normalizeEmail(row[1])
    }))
    .filter((row) => row.name.length > 0 && row.email.length > 0);

  const deduped = new Map<string, EmailSheetEntry>();
  for (const row of rows) {
    if (!deduped.has(row.email)) {
      deduped.set(row.email, row);
    }
  }

  return {
    scannedRows: values.length,
    rows: [...deduped.values()]
  };
}

async function readSheetValues(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string
): Promise<string[][]> {
  const range = encodeURIComponent(sheetName);
  const response = await fetchJson<SheetValuesResponse>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      }
    }
  );

  return response.values ?? [];
}

async function listExistingPermissions(
  accessToken: string,
  target: GoogleDriveTarget
): Promise<Map<string, string>> {
  const permissions = await fetchJson<DrivePermissionsList>(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(target.fileId)}/permissions?supportsAllDrives=true&fields=permissions(id,emailAddress,role)`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json"
      }
    }
  );

  const permissionMap = new Map<string, string>();
  for (const permission of permissions.permissions ?? []) {
    const email = normalizeEmail(permission.emailAddress);
    if (email) {
      permissionMap.set(email, permission.role ?? "existing");
    }
  }
  return permissionMap;
}

async function createPermission(
  accessToken: string,
  target: GoogleDriveTarget,
  email: string
): Promise<void> {
  const query = new URLSearchParams({
    supportsAllDrives: "true",
    sendNotificationEmail: String(target.sendNotificationEmail)
  });

  if (target.emailMessage) {
    query.set("emailMessage", target.emailMessage);
  }

  if (target.useDomainAdminAccess) {
    query.set("useDomainAdminAccess", "true");
  }

  try {
    await fetchJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(target.fileId)}/permissions?${query.toString()}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          type: "user",
          role: target.role,
          emailAddress: email
        })
      }
    );
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.status === 409 ||
        JSON.stringify(error.body).includes("already"))
    ) {
      return;
    }

    throw error;
  }
}

function normalizeEmail(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
