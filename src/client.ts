import { ElfaSDK } from "@elfa-ai/sdk";
import type { ServerConfig } from "./config.js";
import { missingCredential } from "./errors.js";

export interface Credentials {
  apiKey: string | undefined;
}

export interface Deps {
  sdk: ElfaSDK;
  maxResponseChars: number;
}

export class CredentialError extends Error {}

export function buildDeps(
  config: ServerConfig,
  overrides: Partial<Credentials> = {},
): Deps {
  const apiKey = overrides.apiKey ?? config.apiKey;

  if (!apiKey) {
    throw new CredentialError(missingCredential());
  }

  const sdk = new ElfaSDK({
    elfaApiKey: apiKey,
    timeout: config.timeout,
    retries: config.retries,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    ...(config.extraHeaders ? { headers: config.extraHeaders } : {}),
  });

  return {
    sdk,
    maxResponseChars: config.maxResponseChars,
  };
}
