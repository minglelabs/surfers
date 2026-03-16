import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createOnboardingRuntime } from "./app.js";
import { runMemberOnboarding } from "./orchestrator.js";

export async function startServer(): Promise<void> {
  const runtime = await createOnboardingRuntime();

  const server = createServer(async (request, response) => {
    try {
      await routeRequest(request, response, runtime);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error)
        })
      );
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(runtime.env.port, () => {
      console.log(
        `Member onboarding server listening on http://localhost:${runtime.env.port}`
      );
      resolve();
    });
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  runtime: Awaited<ReturnType<typeof createOnboardingRuntime>>
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/health") {
    respondJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/members/onboard") {
    if (!isAuthorized(request, runtime.env.webhookSecret)) {
      respondJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const payload = await readJsonBody(request);
    const result = await runMemberOnboarding({
      memberInput: payload,
      defaultDryRun: runtime.env.defaultDryRun,
      providers: runtime.providers
    });

    respondJson(response, 200, result);
    return;
  }

  respondJson(response, 404, { error: "Not found" });
}

function isAuthorized(
  request: IncomingMessage,
  expectedSecret?: string
): boolean {
  if (!expectedSecret) {
    return true;
  }

  const directSecret = request.headers["x-surfers-secret"];
  if (directSecret === expectedSecret) {
    return true;
  }

  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length) === expectedSecret;
  }

  return false;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > 1_000_000) {
      throw new Error("Request body is too large.");
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return body.length > 0 ? (JSON.parse(body) as unknown) : {};
}

function respondJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(payload, null, 2));
}
