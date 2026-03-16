import type { GoogleFormConfig } from "./config.js";
import type { AppEnv } from "./env.js";
import { getGoogleAccessToken } from "./google-auth.js";
import { fetchJson } from "./http.js";
import { runMemberOnboarding } from "./orchestrator.js";
import type {
  ExecutionResult,
  MemberRequest,
  Provider
} from "./types.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

type SheetValuesResponse = {
  values?: string[][];
};

type SheetBatchUpdateRequest = {
  valueInputOption: "RAW";
  data: Array<{
    range: string;
    values: string[][];
  }>;
};

export type GoogleFormSyncSummary = {
  source: string;
  dryRun: boolean;
  scannedRows: number;
  attemptedRows: number;
  skippedRows: number;
  processedRows: number;
  rows: Array<{
    rowNumber: number;
    email?: string | undefined;
    status: string;
    message: string;
  }>;
};

type SyncRuntime = {
  config: GoogleFormConfig;
  env: AppEnv;
  providers: Provider[];
  defaultDryRun: boolean;
};

export async function syncGoogleFormResponses(
  runtime: SyncRuntime,
  forceDryRun?: boolean
): Promise<GoogleFormSyncSummary> {
  const effectiveDryRun = forceDryRun ?? runtime.defaultDryRun;
  const accessToken = await getGoogleAccessToken(runtime.env, [SHEETS_SCOPE]);
  const values = await readSheetValues(
    accessToken,
    runtime.config.spreadsheetId,
    runtime.config.sheetName
  );
  const headerRowIndex = runtime.config.headerRow - 1;
  const headerRow = [...(values[headerRowIndex] ?? [])];

  if (headerRow.length === 0) {
    throw new Error(
      `No header row found at row ${runtime.config.headerRow} in sheet ${runtime.config.sheetName}.`
    );
  }

  const requiredInputHeaders = [runtime.config.emailColumn];
  for (const header of requiredInputHeaders) {
    if (!headerRow.includes(header)) {
      throw new Error(`Missing required Google Form column: ${header}`);
    }
  }

  const ensuredHeaders = ensureOutputHeaders(headerRow, runtime.config);

  if (
    !effectiveDryRun &&
    ensuredHeaders.changed &&
    ensuredHeaders.headers.length > 0
  ) {
    await updateSingleRange(
      accessToken,
      runtime.config.spreadsheetId,
      `${toSheetRange(runtime.config.sheetName, runtime.config.headerRow, 1, ensuredHeaders.headers.length, runtime.config.headerRow)}`,
      [ensuredHeaders.headers]
    );
  }

  const headerIndex = buildHeaderIndex(ensuredHeaders.headers);
  const resultRows: GoogleFormSyncSummary["rows"] = [];
  let attemptedRows = 0;
  let skippedRows = 0;
  let processedRows = 0;

  for (
    let rowIndex = runtime.config.headerRow;
    rowIndex < values.length;
    rowIndex += 1
  ) {
    const rowNumber = rowIndex + 1;
    const row = values[rowIndex] ?? [];
    const email = getCell(row, headerIndex, runtime.config.emailColumn)
      .trim()
      .toLowerCase();
    const existingStatus = getCell(
      row,
      headerIndex,
      runtime.config.statusColumn
    ).trim();

    if (!email) {
      skippedRows += 1;
      resultRows.push({
        rowNumber,
        status: "skipped",
        message: "Skipped because the email cell is empty."
      });
      continue;
    }

    const eligibilityFailure = getEligibilityFailure(
      row,
      headerIndex,
      runtime.config
    );

    if (eligibilityFailure) {
      skippedRows += 1;
      resultRows.push({
        rowNumber,
        email,
        status: "skipped",
        message: eligibilityFailure
      });
      continue;
    }

    if (existingStatus.length > 0) {
      skippedRows += 1;
      resultRows.push({
        rowNumber,
        email,
        status: "skipped",
        message: `Skipped because ${runtime.config.statusColumn} is already set to ${existingStatus}.`
      });
      continue;
    }

    attemptedRows += 1;

    try {
      const memberInput = buildMemberRequest(row, headerIndex, runtime.config);
      const result = await runMemberOnboarding({
        memberInput,
        defaultDryRun: effectiveDryRun,
        providers: runtime.providers
      });

      if (!effectiveDryRun) {
        await writeSyncResult(
          accessToken,
          runtime.config,
          headerIndex,
          rowNumber,
          result
        );
      }

      processedRows += 1;
      resultRows.push({
        rowNumber,
        email,
        status: result.status,
        message: summarizeExecution(result)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!effectiveDryRun) {
        await writeFailureResult(
          accessToken,
          runtime.config,
          headerIndex,
          rowNumber,
          message
        );
      }

      processedRows += 1;
      resultRows.push({
        rowNumber,
        email,
        status: "failed",
        message
      });
    }
  }

  return {
    source: `${runtime.config.spreadsheetId}/${runtime.config.sheetName}`,
    dryRun: effectiveDryRun,
    scannedRows: Math.max(values.length - runtime.config.headerRow, 0),
    attemptedRows,
    skippedRows,
    processedRows,
    rows: resultRows
  };
}

export function buildMemberRequest(
  row: string[],
  headerIndex: Record<string, number>,
  config: GoogleFormConfig
): MemberRequest {
  const group = getOptionalCell(row, headerIndex, config.groupColumn);

  return {
    email: getCell(row, headerIndex, config.emailColumn).trim(),
    fullName: getOptionalCell(row, headerIndex, config.fullNameColumn),
    givenName: getOptionalCell(row, headerIndex, config.givenNameColumn),
    familyName: getOptionalCell(row, headerIndex, config.familyNameColumn),
    slackUserName: getOptionalCell(
      row,
      headerIndex,
      config.slackUserNameColumn
    ),
    source: config.sourceLabel,
    metadata: group ? { group } : undefined
  };
}

export function columnNumberToLetter(columnNumber: number): string {
  let current = columnNumber;
  let letters = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    current = Math.floor((current - 1) / 26);
  }

  return letters;
}

function buildHeaderIndex(headers: string[]): Record<string, number> {
  return headers.reduce<Record<string, number>>((accumulator, header, index) => {
    accumulator[header] = index;
    return accumulator;
  }, {});
}

function ensureOutputHeaders(
  headers: string[],
  config: GoogleFormConfig
): { headers: string[]; changed: boolean } {
  const nextHeaders = [...headers];
  let changed = false;

  for (const outputHeader of [
    config.statusColumn,
    config.processedAtColumn,
    config.resultColumn
  ]) {
    if (!nextHeaders.includes(outputHeader)) {
      nextHeaders.push(outputHeader);
      changed = true;
    }
  }

  return {
    headers: nextHeaders,
    changed
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

async function writeSyncResult(
  accessToken: string,
  config: GoogleFormConfig,
  headerIndex: Record<string, number>,
  rowNumber: number,
  result: ExecutionResult
): Promise<void> {
  await batchUpdateRanges(accessToken, config.spreadsheetId, [
    {
      range: singleCellRange(
        config.sheetName,
        rowNumber,
        config.statusColumn,
        headerIndex
      ),
      values: [[result.status]]
    },
    {
      range: singleCellRange(
        config.sheetName,
        rowNumber,
        config.processedAtColumn,
        headerIndex
      ),
      values: [[result.finishedAt]]
    },
    {
      range: singleCellRange(
        config.sheetName,
        rowNumber,
        config.resultColumn,
        headerIndex
      ),
      values: [[summarizeExecution(result)]]
    }
  ]);
}

async function writeFailureResult(
  accessToken: string,
  config: GoogleFormConfig,
  headerIndex: Record<string, number>,
  rowNumber: number,
  message: string
): Promise<void> {
  await batchUpdateRanges(accessToken, config.spreadsheetId, [
    {
      range: singleCellRange(
        config.sheetName,
        rowNumber,
        config.statusColumn,
        headerIndex
      ),
      values: [["failed"]]
    },
    {
      range: singleCellRange(
        config.sheetName,
        rowNumber,
        config.processedAtColumn,
        headerIndex
      ),
      values: [[new Date().toISOString()]]
    },
    {
      range: singleCellRange(
        config.sheetName,
        rowNumber,
        config.resultColumn,
        headerIndex
      ),
      values: [[message]]
    }
  ]);
}

async function batchUpdateRanges(
  accessToken: string,
  spreadsheetId: string,
  data: SheetBatchUpdateRequest["data"]
): Promise<void> {
  await fetchJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        valueInputOption: "RAW",
        data
      } satisfies SheetBatchUpdateRequest)
    }
  );
}

async function updateSingleRange(
  accessToken: string,
  spreadsheetId: string,
  range: string,
  values: string[][]
): Promise<void> {
  await fetchJson(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ values })
    }
  );
}

function singleCellRange(
  sheetName: string,
  rowNumber: number,
  headerName: string,
  headerIndex: Record<string, number>
): string {
  const headerPosition = (headerIndex[headerName] ?? -1) + 1;

  if (headerPosition <= 0) {
    throw new Error(`Unknown output header: ${headerName}`);
  }

  const columnLetter = columnNumberToLetter(headerPosition);
  return `${escapeSheetName(sheetName)}!${columnLetter}${rowNumber}`;
}

function toSheetRange(
  sheetName: string,
  startRow: number,
  startColumn: number,
  endColumn: number,
  endRow: number
): string {
  return `${escapeSheetName(sheetName)}!${columnNumberToLetter(startColumn)}${startRow}:${columnNumberToLetter(endColumn)}${endRow}`;
}

function escapeSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function summarizeExecution(result: ExecutionResult): string {
  return result.results
    .map(
      (step) =>
        `${step.provider}/${step.target}:${step.status} (${step.message})`
    )
    .join(" | ");
}

function getCell(
  row: string[],
  headerIndex: Record<string, number>,
  headerName: string
): string {
  const index = headerIndex[headerName];

  if (index === undefined) {
    return "";
  }

  return row[index] ?? "";
}

function getOptionalCell(
  row: string[],
  headerIndex: Record<string, number>,
  headerName?: string | undefined
): string | undefined {
  if (!headerName) {
    return undefined;
  }

  const value = getCell(row, headerIndex, headerName).trim();
  return value.length > 0 ? value : undefined;
}

function getEligibilityFailure(
  row: string[],
  headerIndex: Record<string, number>,
  config: GoogleFormConfig
): string | undefined {
  const group = getOptionalCell(row, headerIndex, config.groupColumn);
  if (config.groupColumn && !group) {
    return `Skipped because ${config.groupColumn} is empty.`;
  }

  const paymentStatus = getOptionalCell(
    row,
    headerIndex,
    config.paymentStatusColumn
  );
  if (
    config.paymentStatusColumn &&
    config.paymentStatusIncludes &&
    (!paymentStatus || !paymentStatus.includes(config.paymentStatusIncludes))
  ) {
    return `Skipped because ${config.paymentStatusColumn} does not include ${config.paymentStatusIncludes}.`;
  }

  const paymentAmount = getOptionalCell(
    row,
    headerIndex,
    config.paymentAmountColumn
  );
  if (config.paymentAmountColumn && !paymentAmount) {
    return `Skipped because ${config.paymentAmountColumn} is empty.`;
  }

  return undefined;
}
