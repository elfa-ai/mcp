import { ElfaSDK } from "@elfa-ai/sdk";
import type { ServerConfig } from "./config.js";
import { missingCredential } from "./errors.js";

export interface Credentials {
  apiKey: string | undefined;
  hmacSecret: string | undefined;
}

export interface Deps {
  sdk: ElfaSDK;
  hasHmac: boolean;
  maxResponseChars: number;
}

export class CredentialError extends Error {}

export function buildDeps(
  config: ServerConfig,
  overrides: Partial<Credentials> = {},
): Deps {
  const apiKey = overrides.apiKey ?? config.apiKey;
  const hmacSecret = overrides.hmacSecret ?? config.hmacSecret;

  if (!apiKey) {
    throw new CredentialError(missingCredential("apiKey"));
  }

  const sdk = new ElfaSDK({
    elfaApiKey: apiKey,
    timeout: config.timeout,
    retries: config.retries,
    ...(hmacSecret ? { hmacSecret } : {}),
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
  });

  return {
    sdk,
    hasHmac: Boolean(hmacSecret),
    maxResponseChars: config.maxResponseChars,
  };
}
