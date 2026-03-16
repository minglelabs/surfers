import { readFile } from "node:fs/promises";
import { JWT } from "google-auth-library";
import type { AppEnv } from "./env.js";

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
};

export async function getGoogleAccessToken(
  env: AppEnv,
  scopes: string[]
): Promise<string> {
  if (!env.googleImpersonateUser) {
    throw new Error("GOOGLE_IMPERSONATE_USER is required.");
  }

  const key = await loadServiceAccountKey(env);
  const jwt = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes,
    subject: env.googleImpersonateUser
  });

  const tokens = await jwt.authorize();

  if (!tokens.access_token) {
    throw new Error("Google access token was not returned.");
  }

  return tokens.access_token;
}

async function loadServiceAccountKey(env: AppEnv): Promise<ServiceAccountKey> {
  if (env.googleServiceAccountJson) {
    return parseServiceAccountKey(env.googleServiceAccountJson);
  }

  if (env.googleServiceAccountFile) {
    const file = await readFile(env.googleServiceAccountFile, "utf8");
    return parseServiceAccountKey(file);
  }

  throw new Error(
    "Either GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_JSON is required."
  );
}

function parseServiceAccountKey(raw: string): ServiceAccountKey {
  const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Google service account JSON is missing required fields.");
  }

  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key
  };
}
