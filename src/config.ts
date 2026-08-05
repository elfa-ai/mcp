export type TransportMode = "stdio" | "http";

export interface ServerConfig {
  transport: TransportMode;
  port: number;
  host: string;
  allowedOrigins: string[];
  apiKey: string | undefined;
  hmacSecret: string | undefined;
  baseUrl: string | undefined;
  extraHeaders: Record<string, string> | undefined;
  timeout: number;
  retries: number;
  maxResponseChars: number;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const transport: TransportMode =
    env.ELFA_MCP_TRANSPORT === "http" ? "http" : "stdio";

  return {
    transport,
    port: num(env.ELFA_MCP_PORT, DEFAULT_PORT),
    host: env.ELFA_MCP_HOST || DEFAULT_HOST,
    allowedOrigins: list(env.ELFA_MCP_ALLOWED_ORIGINS),
    apiKey: env.ELFA_API_KEY || undefined,
    hmacSecret: env.ELFA_HMAC_SECRET || undefined,
    baseUrl: env.ELFA_BASE_URL || undefined,
    extraHeaders: headers(env.ELFA_EXTRA_HEADERS),
    timeout: num(env.ELFA_TIMEOUT, DEFAULT_TIMEOUT),
    retries: count(env.ELFA_RETRIES, DEFAULT_RETRIES),
    maxResponseChars: num(
      env.ELFA_MCP_MAX_RESPONSE_CHARS,
      DEFAULT_MAX_RESPONSE_CHARS,
    ),
  };
}
