import { ElfaSDK } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config.js";
import { missingCredential } from "./errors.js";
import { userAgent, withUserAgent } from "./userAgent.js";

export interface Credentials {
  apiKey: string | undefined;
}

export interface DepsOverrides extends Partial<Credentials> {
  client?: string | undefined;
}

export interface Deps {
  sdk: ElfaSDK;
  maxResponseChars: number;
}

export class CredentialError extends Error {}

export function buildDeps(
  config: ServerConfig,
  overrides: DepsOverrides = {},
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
    headers: withUserAgent(
      config.extraHeaders,
      userAgent(config.transport, overrides.client),
    ),
  });

  return {
    sdk,
    maxResponseChars: config.maxResponseChars,
  };
}

export function identifyClientOnInitialize(
  server: McpServer,
  deps: Deps,
  config: ServerConfig,
): void {
  server.server.oninitialized = () => {
    const info = server.server.getClientVersion();
    if (!info) return;
    deps.sdk = buildDeps(config, {
      client: `${info.name}/${info.version}`,
    }).sdk;
  };
}
