export type TransportMode = "stdio" | "http";

export interface ServerConfig {
  transport: TransportMode;
  port: number;
  host: string;
  allowedOrigins: string[];
  apiKey: string | undefined;
  hmacSecret: string | undefined;
  baseUrl: string | undefined;
  timeout: number;
  maxResponseChars: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RESPONSE_CHARS = 60000;

function num(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    timeout: num(env.ELFA_TIMEOUT, DEFAULT_TIMEOUT),
    maxResponseChars: num(
      env.ELFA_MCP_MAX_RESPONSE_CHARS,
      DEFAULT_MAX_RESPONSE_CHARS,
    ),
  };
}
