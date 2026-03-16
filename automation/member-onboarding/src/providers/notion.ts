import type { AppEnv } from "../env.js";
import { fetchJson, getErrorMessage } from "../http.js";
import type {
  ExecutionContext,
  NormalizedMember,
  Provider,
  StepResult
} from "../types.js";

type NotionConfig = {
  mode: "disabled" | "scim" | "database";
  role: "owner" | "membership_admin" | "member" | "restricted_member";
  database?: {
    databaseId: string;
    titleProperty: string;
    introProperty: string;
    goalProperty: string;
    groupProperty: string;
    presentationProperty: string;
    defaultIntro: string;
    defaultGoal: string;
    defaultPresentation: boolean;
  } | undefined;
};

type NotionScimList = {
  Resources?: Array<{ id: string; userName: string; active?: boolean }>;
};

type NotionDatabaseCreateResponse = {
  id: string;
  url: string;
};

type NotionDatabaseQueryResponse = {
  results: Array<{
    id: string;
    url: string;
  }>;
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
      if (this.config.mode === "database") {
        return [
          {
            provider: this.name,
            target: this.config.database?.databaseId ?? "database",
            status: "dry_run",
            message: `Would create a Notion member record for ${member.fullName}.`
          }
        ];
      }

      return [
        {
          provider: this.name,
          target: "workspace",
          status: "dry_run",
          message: `Would provision ${member.email} in Notion with role ${this.config.role}.`
        }
      ];
    }

    if (this.config.mode === "database") {
      return [await this.createDatabaseRow(member)];
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

  private async createDatabaseRow(
    member: NormalizedMember
  ): Promise<StepResult> {
    if (!this.config.database) {
      return {
        provider: this.name,
        target: "database",
        status: "failed",
        message: "Notion database mode requires notion.database configuration."
      };
    }

    const token = this.env.notionApiToken ?? this.env.notionToken;

    if (!token) {
      return {
        provider: this.name,
        target: this.config.database.databaseId,
        status: "failed",
        message:
          "NOTION_API_TOKEN or NOTION_TOKEN is required when Notion database mode is enabled."
      };
    }

    const group = member.metadata?.group;
    const properties: Record<string, unknown> = {
      [this.config.database.titleProperty]: {
        title: [{ text: { content: member.fullName } }]
      },
      [this.config.database.introProperty]: {
        rich_text: this.config.database.defaultIntro
          ? [{ text: { content: this.config.database.defaultIntro } }]
          : []
      },
      [this.config.database.goalProperty]: {
        rich_text: this.config.database.defaultGoal
          ? [{ text: { content: this.config.database.defaultGoal } }]
          : []
      },
      [this.config.database.presentationProperty]: {
        checkbox: this.config.database.defaultPresentation
      }
    };

    if (group) {
      properties[this.config.database.groupProperty] = {
        select: {
          name: group
        }
      };
    }

    try {
      const existing = await fetchJson<NotionDatabaseQueryResponse>(
        `https://api.notion.com/v1/databases/${this.config.database.databaseId}/query`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
            "notion-version": "2022-06-28"
          },
          body: JSON.stringify({
            filter: {
              property: this.config.database.titleProperty,
              title: {
                equals: member.fullName
              }
            },
            page_size: 1
          })
        }
      );

      if (existing.results.length > 0) {
        return {
          provider: this.name,
          target: this.config.database.databaseId,
          status: "success",
          message: `A Notion member record already exists for ${member.fullName}.`,
          data: existing.results[0]
        };
      }

      const created = await fetchJson<NotionDatabaseCreateResponse>(
        "https://api.notion.com/v1/pages",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
            "notion-version": "2022-06-28"
          },
          body: JSON.stringify({
            parent: {
              database_id: this.config.database.databaseId
            },
            properties
          })
        }
      );

      return {
        provider: this.name,
        target: this.config.database.databaseId,
        status: "success",
        message: `Created a Notion member record for ${member.fullName}.`,
        data: created
      };
    } catch (error) {
      return {
        provider: this.name,
        target: this.config.database.databaseId,
        status: "failed",
        message: getErrorMessage(error)
      };
    }
  }
}
