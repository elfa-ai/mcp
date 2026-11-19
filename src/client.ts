import { ElfaSDK } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ServerConfig } from "./config.js";
import { missingCredential } from "./errors.js";
import { userAgent, withUserAgent } from "./userAgent.js";
import { createV3Client, type V3Client } from "./v3.js";

export interface Credentials {
  apiKey: string | undefined;
  /** An exchanged OAuth token for the Elfa API; wins over apiKey when set. */
  accessToken?: string | undefined;
}

export interface DepsOverrides extends Partial<Credentials> {
  client?: string | undefined;
}

export interface Deps {
  sdk: ElfaSDK;
  v3: V3Client;
  maxResponseChars: number;
}

export class CredentialError extends Error {}

export function buildDeps(
  config: ServerConfig,
  overrides: DepsOverrides = {},
): Deps {
  const accessToken = overrides.accessToken;
  const apiKey = accessToken ? undefined : (overrides.apiKey ?? config.apiKey);

  if (!accessToken && !apiKey) {
    throw new CredentialError(missingCredential());
  }

  const headers = withUserAgent(
    config.extraHeaders,
    userAgent(config.transport, overrides.client),
  );

  const sdk = new ElfaSDK({
    ...(accessToken ? { accessToken } : { elfaApiKey: apiKey! }),
    timeout: config.timeout,
    retries: config.retries,
    ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}),
    headers,
  });

  const v3 = createV3Client({
    ...(accessToken ? { accessToken } : { apiKey: apiKey! }),
    baseUrl: config.baseUrl,
    timeout: config.timeout,
    retries: config.retries,
    headers,
  });

  return {
    sdk,
    v3,
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
    const next = buildDeps(config, {
      client: `${info.name}/${info.version}`,
    });
    deps.sdk = next.sdk;
    deps.v3 = next.v3;
  };
}
