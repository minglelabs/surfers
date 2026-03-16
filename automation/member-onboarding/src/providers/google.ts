import type {
  GoogleDriveTarget,
  GoogleGroupTarget
} from "../config.js";
import type { AppEnv } from "../env.js";
import { getGoogleAccessToken } from "../google-auth.js";
import { fetchJson, getErrorMessage, HttpError } from "../http.js";
import type {
  ExecutionContext,
  NormalizedMember,
  Provider,
  StepResult
} from "../types.js";

type GoogleConfig = {
  groups: GoogleGroupTarget[];
  driveTargets: GoogleDriveTarget[];
};

type DrivePermissionsList = {
  permissions?: Array<{
    id: string;
    emailAddress?: string;
    role?: string;
  }>;
};

const DIRECTORY_SCOPE =
  "https://www.googleapis.com/auth/admin.directory.group.member";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

export class GoogleProvider implements Provider {
  readonly name = "google";

  constructor(
    private readonly config: GoogleConfig,
    private readonly env: AppEnv
  ) {}

  async onboard(
    member: NormalizedMember,
    context: ExecutionContext
  ): Promise<StepResult[]> {
    if (this.config.groups.length === 0 && this.config.driveTargets.length === 0) {
      return [
        {
          provider: this.name,
          target: "workspace",
          status: "skipped",
          message: "Google automation has no configured targets."
        }
      ];
    }

    const groupResults = await this.onboardGroups(member, context);
    const driveResults = await this.onboardDriveTargets(member, context);
    return [...groupResults, ...driveResults];
  }

  private async onboardGroups(
    member: NormalizedMember,
    context: ExecutionContext
  ): Promise<StepResult[]> {
    if (this.config.groups.length === 0) {
      return [];
    }

    if (!this.env.googleImpersonateUser) {
      return this.config.groups.map((group) => ({
        provider: "google-groups",
        target: group.email,
        status: "skipped" as const,
        message:
          "Google Groups automation requires GOOGLE_IMPERSONATE_USER and a Google Workspace domain."
      }));
    }

    if (context.dryRun) {
      return this.config.groups.map((group) => ({
        provider: "google-groups",
        target: group.email,
        status: "dry_run" as const,
        message: `Would add ${member.email} to Google Group ${group.email} as ${group.role}.`
      }));
    }

    try {
      const accessToken = await getGoogleAccessToken(this.env, [DIRECTORY_SCOPE], {
        subject: this.env.googleImpersonateUser
      });

      return await Promise.all(
        this.config.groups.map((group) =>
          this.addGroupMember(accessToken, group, member)
        )
      );
    } catch (error) {
      const message = getErrorMessage(error);
      return this.config.groups.map((group) => ({
        provider: "google-groups",
        target: group.email,
        status: "failed" as const,
        message
      }));
    }
  }

  private async onboardDriveTargets(
    member: NormalizedMember,
    context: ExecutionContext
  ): Promise<StepResult[]> {
    if (this.config.driveTargets.length === 0) {
      return [];
    }

    if (context.dryRun) {
      return this.config.driveTargets.map((target) => ({
        provider: "google-drive",
        target: target.label ?? target.fileId,
        status: "dry_run" as const,
        message: `Would grant ${target.role} access on ${target.label ?? target.fileId} to ${member.email}.`
      }));
    }

    try {
      const accessToken = await getGoogleAccessToken(this.env, [DRIVE_SCOPE]);

      return await Promise.all(
        this.config.driveTargets.map((target) =>
          this.grantDriveAccess(accessToken, target, member)
        )
      );
    } catch (error) {
      const message = getErrorMessage(error);
      return this.config.driveTargets.map((target) => ({
        provider: "google-drive",
        target: target.label ?? target.fileId,
        status: "failed" as const,
        message
      }));
    }
  }

  private async addGroupMember(
    accessToken: string,
    group: GoogleGroupTarget,
    member: NormalizedMember
  ): Promise<StepResult> {
    const url = `https://admin.googleapis.com/admin/directory/v1/groups/${encodeURIComponent(group.email)}/members`;

    try {
      await fetchJson(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          email: member.email,
          role: group.role
        })
      });

      return {
        provider: "google-groups",
        target: group.email,
        status: "success",
        message: `Added ${member.email} to Google Group ${group.email} as ${group.role}.`
      };
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 409 || JSON.stringify(error.body).includes("Member already exists"))
      ) {
        return {
          provider: "google-groups",
          target: group.email,
          status: "success",
          message: `${member.email} is already a member of Google Group ${group.email}.`
        };
      }

      return {
        provider: "google-groups",
        target: group.email,
        status: "failed",
        message: getErrorMessage(error)
      };
    }
  }

  private async grantDriveAccess(
    accessToken: string,
    target: GoogleDriveTarget,
    member: NormalizedMember
  ): Promise<StepResult> {
    const permissionsUrl =
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(target.fileId)}/permissions` +
      "?supportsAllDrives=true&fields=permissions(id,emailAddress,role)";

    try {
      const existing = await fetchJson<DrivePermissionsList>(permissionsUrl, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json"
        }
      });

      const alreadyGranted = existing.permissions?.find(
        (permission) =>
          permission.emailAddress?.toLowerCase() === member.email.toLowerCase()
      );

      if (alreadyGranted) {
        return {
          provider: "google-drive",
          target: target.label ?? target.fileId,
          status: "success",
          message: `${member.email} already has ${alreadyGranted.role ?? "existing"} access to ${target.label ?? target.fileId}.`,
          data: alreadyGranted
        };
      }

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
            emailAddress: member.email
          })
        }
      );

      return {
        provider: "google-drive",
        target: target.label ?? target.fileId,
        status: "success",
        message: `Granted ${target.role} access on ${target.label ?? target.fileId} to ${member.email}.`
      };
    } catch (error) {
      return {
        provider: "google-drive",
        target: target.label ?? target.fileId,
        status: "failed",
        message: getErrorMessage(error)
      };
    }
  }
}
