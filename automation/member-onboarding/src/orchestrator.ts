import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  ExecutionContext,
  ExecutionResult,
  MemberRequest,
  NormalizedMember,
  OverallStatus,
  Provider,
  StepResult
} from "./types.js";

export const memberRequestSchema = z
  .object({
    email: z.string().trim().email(),
    fullName: z.string().trim().min(1).optional(),
    givenName: z.string().trim().min(1).optional(),
    familyName: z.string().trim().min(1).optional(),
    slackUserName: z.string().trim().min(1).max(21).optional(),
    source: z.string().trim().min(1).optional(),
    dryRun: z.boolean().optional(),
    metadata: z.record(z.string()).optional()
  })
  .strict();

export async function runMemberOnboarding(input: {
  memberInput: unknown;
  defaultDryRun: boolean;
  providers: Provider[];
}): Promise<ExecutionResult> {
  const memberRequest = memberRequestSchema.parse(input.memberInput);
  const member = normalizeMember(memberRequest);
  const context: ExecutionContext = {
    executionId: randomUUID(),
    dryRun: memberRequest.dryRun ?? input.defaultDryRun,
    startedAt: new Date().toISOString()
  };

  const results: StepResult[] = [];

  for (const provider of input.providers) {
    try {
      const providerResults = await provider.onboard(member, context);
      results.push(...providerResults);
    } catch (error) {
      results.push({
        provider: provider.name,
        target: provider.name,
        status: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    executionId: context.executionId,
    status: summarizeResults(results),
    dryRun: context.dryRun,
    member,
    startedAt: context.startedAt,
    finishedAt: new Date().toISOString(),
    results
  };
}

export function normalizeMember(member: MemberRequest): NormalizedMember {
  const email = member.email.trim().toLowerCase();
  const givenName = member.givenName?.trim();
  const familyName = member.familyName?.trim();
  const derivedName =
    member.fullName?.trim() ||
    [givenName, familyName].filter(Boolean).join(" ").trim() ||
    email.split("@")[0] ||
    email;

  return {
    email,
    fullName: derivedName,
    givenName,
    familyName,
    slackUserName:
      member.slackUserName?.trim() || buildSlackUserName(email, derivedName),
    source: member.source,
    metadata: member.metadata
  };
}

export function summarizeResults(results: StepResult[]): OverallStatus {
  if (results.length === 0) {
    return "success";
  }

  const statuses = results.map((result) => result.status);
  const hasFailure = statuses.includes("failed");
  const hasSuccess = statuses.includes("success");
  const hasDryRun = statuses.includes("dry_run");

  if (hasFailure && hasSuccess) {
    return "partial_failure";
  }

  if (hasFailure) {
    return "failed";
  }

  if (hasDryRun && !hasSuccess) {
    return "dry_run";
  }

  return "success";
}

export function buildSlackUserName(
  email: string,
  preferredName?: string
): string {
  const localPart = email.split("@")[0] || "member";
  const baseSource = preferredName?.trim() || localPart;
  const cleaned = baseSource
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  const shortBase = (cleaned || "member").slice(0, 16);
  const suffix = createHash("sha1").update(email).digest("hex").slice(0, 4);
  return `${shortBase}-${suffix}`.slice(0, 21);
}
