import pkg from "../package.json" with { type: "json" };
import type { TransportMode } from "./config.js";

const PRODUCT = "elfa-mcp";
const CLIENT_MAX_LENGTH = 100;

export function sanitizeClient(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value
    .replace(/[^\x20-\x7e]|[();\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CLIENT_MAX_LENGTH)
    .trim();
  return clean || undefined;
}

export function userAgent(transport: TransportMode, client?: string): string {
  const name = sanitizeClient(client);
  const detail = name ? `${transport}; client=${name}` : transport;
  return `${PRODUCT}/${pkg.version} (${detail})`;
}

export function withUserAgent(
  headers: Record<string, string> | undefined,
  value: string,
): Record<string, string> {
  const operatorSetsOne = Object.keys(headers ?? {}).some(
    (name) => name.toLowerCase() === "user-agent",
  );
  return operatorSetsOne ? { ...headers } : { "User-Agent": value, ...headers };
}
