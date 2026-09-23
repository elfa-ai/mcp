export type TransportMode = "stdio" | "http";
export type AuthMode = "apikey" | "oauth";

/**
 * OAuth resource-server settings (HTTP transport only). The server never
 * issues tokens: it points clients at the authorization server, then checks
 * each bearer token against that server's introspection endpoint, which
 * answers with the API key the request should run as.
 */
export interface OAuthConfig {
  /** Canonical URL of this MCP endpoint, e.g. https://mcp.elfa.ai/mcp. */
  resource: string;
  /** Authorization server issuer, listed in the protected-resource metadata. */
  issuer: string;
  introspectionUrl: string;
  introspectionToken: string;
  scopes: string[];
}

export interface ServerConfig {
  transport: TransportMode;
  port: number;
  host: string;
  allowedOrigins: string[];
  allowedHosts: string[];
  apiKey: string | undefined;
  baseUrl: string | undefined;
  extraHeaders: Record<string, string> | undefined;
  timeout: number;
  retries: number;
  maxResponseChars: number;
  auth: AuthMode;
  oauth: OAuthConfig | undefined;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT = 120000;
const DEFAULT_RETRIES = 0;
const DEFAULT_MAX_RESPONSE_CHARS = 60000;

const RESERVED = new Set(["x-elfa-api-key", "x-elfa-signature", "x-elfa-timestamp"]);

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function count(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function headers(value: string | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return undefined;
    }
    const out: Record<string, string> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "string" && !RESERVED.has(key.toLowerCase())) {
        out[key] = entry;
      }
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

function list(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export class ConfigError extends Error {}

function oauthConfig(env: NodeJS.ProcessEnv): OAuthConfig {
  const required = {
    ELFA_MCP_RESOURCE_URL: env.ELFA_MCP_RESOURCE_URL,
    ELFA_OAUTH_ISSUER: env.ELFA_OAUTH_ISSUER,
    ELFA_OAUTH_INTROSPECTION_URL: env.ELFA_OAUTH_INTROSPECTION_URL,
    ELFA_OAUTH_INTROSPECTION_TOKEN: env.ELFA_OAUTH_INTROSPECTION_TOKEN,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new ConfigError(
      `ELFA_MCP_AUTH=oauth requires ${missing.join(", ")}.`,
    );
  }
  return {
    resource: required.ELFA_MCP_RESOURCE_URL!,
    issuer: required.ELFA_OAUTH_ISSUER!,
    introspectionUrl: required.ELFA_OAUTH_INTROSPECTION_URL!,
    introspectionToken: required.ELFA_OAUTH_INTROSPECTION_TOKEN!,
    scopes: list(env.ELFA_OAUTH_SCOPES).length > 0 ? list(env.ELFA_OAUTH_SCOPES) : ["elfa"],
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const transport: TransportMode =
    env.ELFA_MCP_TRANSPORT === "http" ? "http" : "stdio";
  const auth: AuthMode = env.ELFA_MCP_AUTH === "oauth" ? "oauth" : "apikey";
  if (auth === "oauth" && transport !== "http") {
    throw new ConfigError("ELFA_MCP_AUTH=oauth needs ELFA_MCP_TRANSPORT=http.");
  }

  return {
    transport,
    port: num(env.ELFA_MCP_PORT, DEFAULT_PORT),
    host: env.ELFA_MCP_HOST || DEFAULT_HOST,
    allowedOrigins: list(env.ELFA_MCP_ALLOWED_ORIGINS),
    allowedHosts: list(env.ELFA_MCP_ALLOWED_HOSTS),
    // In oauth mode every request brings its own credential. An environment
    // key would be handed to any caller that sends none, so it is ignored.
    apiKey: auth === "oauth" ? undefined : env.ELFA_API_KEY || undefined,
    baseUrl: env.ELFA_BASE_URL || undefined,
    extraHeaders: headers(env.ELFA_EXTRA_HEADERS),
    timeout: num(env.ELFA_TIMEOUT, DEFAULT_TIMEOUT),
    retries: count(env.ELFA_RETRIES, DEFAULT_RETRIES),
    maxResponseChars: num(
      env.ELFA_MCP_MAX_RESPONSE_CHARS,
      DEFAULT_MAX_RESPONSE_CHARS,
    ),
    auth,
    oauth: auth === "oauth" ? oauthConfig(env) : undefined,
  };
}
