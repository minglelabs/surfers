import { loadConfig } from "./config.js";
import { loadEnv } from "./env.js";
import { createProviders } from "./providers/index.js";

export async function createOnboardingRuntime() {
  const env = loadEnv();
  const config = await loadConfig(env.configPath);
  const providers = createProviders(config, env);

  return {
    env,
    config,
    providers
  };
}
