import type { OnboardingConfig } from "../config.js";
import type { AppEnv } from "../env.js";
import type { Provider } from "../types.js";
import { GoogleProvider } from "./google.js";
import { NotionProvider } from "./notion.js";
import { SlackProvider } from "./slack.js";

export function createProviders(
  config: OnboardingConfig,
  env: AppEnv
): Provider[] {
  return [
    new SlackProvider(config.slack, env),
    new NotionProvider(config.notion, env),
    new GoogleProvider(config.google, env)
  ];
}
