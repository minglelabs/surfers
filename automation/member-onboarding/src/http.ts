export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, init);
  const rawBody = await response.text();
  const body = parseResponseBody(rawBody, response.headers.get("content-type"));

  if (!response.ok) {
    throw new HttpError(
      `${init.method ?? "GET"} ${url} failed with ${response.status}`,
      response.status,
      body
    );
  }

  return body as T;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof HttpError) {
    if (typeof error.body === "string" && error.body.length > 0) {
      return `${error.message}: ${error.body}`;
    }

    if (error.body && typeof error.body === "object") {
      return `${error.message}: ${JSON.stringify(error.body)}`;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function parseResponseBody(
  rawBody: string,
  contentType: string | null
): unknown {
  if (rawBody.length === 0) {
    return undefined;
  }

  if (contentType?.includes("application/json") || rawBody.startsWith("{")) {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return rawBody;
    }
  }

  return rawBody;
}
