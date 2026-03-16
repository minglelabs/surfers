export type StepStatus = "success" | "failed" | "skipped" | "dry_run";

export type OverallStatus =
  | "success"
  | "failed"
  | "partial_failure"
  | "dry_run";

export type MemberRequest = {
  email: string;
  fullName?: string | undefined;
  givenName?: string | undefined;
  familyName?: string | undefined;
  slackUserName?: string | undefined;
  source?: string | undefined;
  dryRun?: boolean | undefined;
  metadata?: Record<string, string> | undefined;
};

export type NormalizedMember = {
  email: string;
  fullName: string;
  givenName?: string | undefined;
  familyName?: string | undefined;
  slackUserName: string;
  source?: string | undefined;
  metadata?: Record<string, string> | undefined;
};

export type ExecutionContext = {
  executionId: string;
  dryRun: boolean;
  startedAt: string;
};

export type StepResult = {
  provider: string;
  target: string;
  status: StepStatus;
  message: string;
  data?: unknown;
};

export type ExecutionResult = {
  executionId: string;
  status: OverallStatus;
  dryRun: boolean;
  member: NormalizedMember;
  startedAt: string;
  finishedAt: string;
  results: StepResult[];
};

export interface Provider {
  readonly name: string;
  onboard(member: NormalizedMember, context: ExecutionContext): Promise<StepResult[]>;
}
