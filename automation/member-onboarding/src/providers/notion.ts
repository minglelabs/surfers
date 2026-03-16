import type { AppEnv } from "../env.js";
import { fetchJson, getErrorMessage } from "../http.js";
import type {
  ExecutionContext,
  NormalizedMember,
  Provider,
  StepResult
} from "../types.js";

type NotionConfig = {
  mode: "disabled" | "scim";
  role: "owner" | "membership_admin" | "member" | "restricted_member";
};

type NotionScimList = {
  Resources?: Array<{ id: string; userName: string; active?: boolean }>;
};

export class NotionProvider implements Provider {
  readonly name = "notion";

  constructor(
    private readonly config: NotionConfig,
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
          message: "Notion automation is disabled."
        }
      ];
    }

    if (context.dryRun) {
      return [
        {
          provider: this.name,
          target: "workspace",
          status: "dry_run",
          message: `Would provision ${member.email} in Notion with role ${this.config.role}.`
        }
      ];
    }

    if (!this.env.notionToken) {
      return [
        {
          provider: this.name,
          target: "workspace",
          status: "failed",
          message: "NOTION_TOKEN is required when Notion automation is enabled."
        }
      ];
    }

    try {
      const filter = encodeURIComponent(`userName eq "${member.email}"`);
      const existing = await fetchJson<NotionScimList>(
        `${this.env.notionScimBaseUrl}/Users?filter=${filter}`,
        {
          headers: {
            authorization: `Bearer ${this.env.notionToken}`,
            accept: "application/json"
          }
        }
      );

      if ((existing.Resources?.length ?? 0) > 0) {
        return [
          {
            provider: this.name,
            target: "workspace",
            status: "success",
            message: `Notion user already exists for ${member.email}.`,
            data: existing.Resources?.[0]
          }
        ];
      }

      await fetchJson(`${this.env.notionScimBaseUrl}/Users`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.env.notionToken}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify({
          schemas: [
            "urn:ietf:params:scim:schemas:core:2.0:User",
            "urn:ietf:params:scim:schemas:extension:notion:2.0:User"
          ],
          userName: member.email,
          active: true,
          emails: [{ value: member.email, primary: true }],
          name: {
            givenName: member.givenName,
            familyName: member.familyName,
            formatted: member.fullName
          },
          "urn:ietf:params:scim:schemas:extension:notion:2.0:User": {
            role: this.config.role
          }
        })
      });

      return [
        {
          provider: this.name,
          target: "workspace",
          status: "success",
          message: `Provisioned ${member.email} in Notion with role ${this.config.role}.`
        }
      ];
    } catch (error) {
      return [
        {
          provider: this.name,
          target: "workspace",
          status: "failed",
          message: getErrorMessage(error)
        }
      ];
    }
  }
}
