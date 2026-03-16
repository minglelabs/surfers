import type { AppEnv } from "../env.js";
import { fetchJson, getErrorMessage, HttpError } from "../http.js";
import type {
  ExecutionContext,
  NormalizedMember,
  Provider,
  StepResult
} from "../types.js";

type SlackConfig = {
  mode: "disabled" | "scim" | "admin";
  defaultChannels: string[];
  customMessage?: string | undefined;
};

type SlackScimUserList = {
  Resources?: Array<{ id: string; userName: string }>;
};

type SlackAdminInviteResponse = {
  ok: boolean;
  error?: string;
};

export class SlackProvider implements Provider {
  readonly name = "slack";

  constructor(
    private readonly config: SlackConfig,
    private readonly env: AppEnv
  ) {}

  async onboard(
    member: NormalizedMember,
    context: ExecutionContext
  ): Promise<StepResult[]> {
    if (this.config.mode === "disabled") {
      return [
        {
          provider: this.name,
          target: "workspace",
          status: "skipped",
          message: "Slack automation is disabled."
        }
      ];
    }

    if (context.dryRun) {
      return [
        {
          provider: this.name,
          target: "workspace",
          status: "dry_run",
          message:
            this.config.mode === "scim"
              ? `Would provision ${member.email} through Slack SCIM.`
              : `Would invite ${member.email} to Slack workspace ${this.env.slackTeamId ?? "(missing team id)"}.`
        }
      ];
    }

    if (!this.env.slackToken) {
      return [
        {
          provider: this.name,
          target: "workspace",
          status: "failed",
          message: "SLACK_TOKEN is required when Slack automation is enabled."
        }
      ];
    }

    if (this.config.mode === "scim") {
      return [await this.onboardWithScim(member)];
    }

    return [await this.onboardWithAdminInvite(member)];
  }

  private async onboardWithScim(member: NormalizedMember): Promise<StepResult> {
    const existing = await this.findExistingUser(member.email);

    if (existing) {
      return {
        provider: this.name,
        target: "workspace",
        status: "success",
        message: `Slack user already exists for ${member.email}.`,
        data: existing
      };
    }

    const body = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: member.slackUserName,
      displayName: member.fullName,
      active: true,
      emails: [{ value: member.email, primary: true }],
      name: {
        givenName: member.givenName,
        familyName: member.familyName,
        formatted: member.fullName
      }
    };

    try {
      await fetchJson(`${this.env.slackScimBaseUrl}/Users`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.env.slackToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      return {
        provider: this.name,
        target: "workspace",
        status: "success",
        message: `Provisioned ${member.email} in Slack via SCIM.`
      };
    } catch (error) {
      if (
        error instanceof HttpError &&
        (error.status === 409 || JSON.stringify(error.body).includes("already exists"))
      ) {
        return {
          provider: this.name,
          target: "workspace",
          status: "success",
          message: `Slack user already exists for ${member.email}.`
        };
      }

      return {
        provider: this.name,
        target: "workspace",
        status: "failed",
        message: getErrorMessage(error)
      };
    }
  }

  private async onboardWithAdminInvite(
    member: NormalizedMember
  ): Promise<StepResult> {
    if (!this.env.slackTeamId) {
      return {
        provider: this.name,
        target: "workspace",
        status: "failed",
        message: "SLACK_TEAM_ID is required for Slack admin mode."
      };
    }

    if (this.config.defaultChannels.length === 0) {
      return {
        provider: this.name,
        target: "workspace",
        status: "failed",
        message: "Slack admin mode requires at least one default channel ID."
      };
    }

    try {
      const response = await fetchJson<SlackAdminInviteResponse>(
        "https://slack.com/api/admin.users.invite",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.env.slackToken}`,
            "content-type": "application/json; charset=utf-8",
            accept: "application/json"
          },
          body: JSON.stringify({
            email: member.email,
            team_id: this.env.slackTeamId,
            channel_ids: this.config.defaultChannels.join(","),
            real_name: member.fullName,
            custom_message: this.config.customMessage,
            resend: false
          })
        }
      );

      if (response.ok) {
        return {
          provider: this.name,
          target: "workspace",
          status: "success",
          message: `Invited ${member.email} to Slack workspace ${this.env.slackTeamId}.`
        };
      }

      return {
        provider: this.name,
        target: "workspace",
        status:
          response.error === "already_in_team" ||
          response.error === "already_in_team_invited_user"
            ? "success"
            : "failed",
        message:
          response.error === "already_in_team" ||
          response.error === "already_in_team_invited_user"
            ? `Slack already has a pending or active membership for ${member.email}.`
            : `Slack invite failed: ${response.error ?? "unknown_error"}`
      };
    } catch (error) {
      return {
        provider: this.name,
        target: "workspace",
        status: "failed",
        message: getErrorMessage(error)
      };
    }
  }

  private async findExistingUser(
    email: string
  ): Promise<{ id: string; userName: string } | undefined> {
    const filter = encodeURIComponent(`email eq "${email}"`);
    const list = await fetchJson<SlackScimUserList>(
      `${this.env.slackScimBaseUrl}/Users?filter=${filter}`,
      {
        headers: {
          authorization: `Bearer ${this.env.slackToken}`,
          accept: "application/json"
        }
      }
    );

    return list.Resources?.[0];
  }
}
