import { createHash } from "node:crypto";
import type { OAuthConfig } from "./config.js";

/**
 * OAuth resource-server side of the HTTP transport (MCP authorization spec).
 *
 * The server does not issue or parse tokens. It advertises its authorization
 * server through RFC 9728 protected-resource metadata, answers unauthenticated
 * requests with a `WWW-Authenticate` challenge that points there, and checks
 * each bearer token with the authorization server's introspection endpoint.
 * A valid token introspects to the Elfa API key the request runs as, so the
 * token itself is never forwarded to the Elfa API.
 */

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 10_000;
const INTROSPECTION_TIMEOUT_MS = 5_000;

export class IntrospectionUnavailableError extends Error {}

export interface VerifiedToken {
  apiKey: string;
  expiresAtMs: number;
}

/** Path of the metadata document for this resource (RFC 9728 §3.1). */
export function protectedResourceMetadataPath(resource: string): string {
  const { pathname } = new URL(resource);
  const suffix = pathname === "/" ? "" : pathname.replace(/\/+$/, "");
  return `/.well-known/oauth-protected-resource${suffix}`;
}

export function protectedResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  return `${url.origin}${protectedResourceMetadataPath(resource)}`;
}

export function protectedResourceMetadata(config: OAuthConfig) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: config.scopes,
    bearer_methods_supported: ["header"],
    resource_name: "Elfa",
    resource_documentation: "https://docs.elfa.ai/mcp",
  };
}

/** RFC 6750 §3 challenge, carrying the metadata URL (RFC 9728 §5.1). */
export function bearerChallenge(
  config: OAuthConfig,
  error?: { code: "invalid_token"; description: string },
): string {
  const parts = [
    `resource_metadata="${protectedResourceMetadataUrl(config.resource)}"`,
    `scope="${config.scopes.join(" ")}"`,
  ];
  if (error) {
    parts.unshift(`error="${error.code}"`);
    parts.push(`error_description="${error.description.replace(/"/g, "'")}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

export function bearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
  return match?.[1];
}

interface IntrospectionResponse {
  active?: boolean;
  aud?: string | string[];
  exp?: number;
  elfa_api_key?: string;
}

/**
 * Introspects bearer tokens and caches good answers for up to a minute, or
 * until the token expires if sooner. That minute bounds how long a revoked
 * token keeps working here; the API key behind it is refused by the Elfa API
 * as soon as it is revoked, so in practice the window is shorter.
 */
export class TokenVerifier {
  private readonly cache = new Map<string, VerifiedToken>();

  constructor(
    private readonly config: OAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** The API key for a valid token, or undefined when the token is not valid. */
  async verify(token: string): Promise<VerifiedToken | undefined> {
    const cacheKey = createHash("sha256").update(token).digest("hex");
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs > this.now()) return cached;
    if (cached) this.cache.delete(cacheKey);

    const body = await this.introspect(token);
    if (!body.active || typeof body.elfa_api_key !== "string") return undefined;

    // The token must have been issued for THIS server (RFC 8707). The
    // authorization server serves other resources too.
    const audiences = Array.isArray(body.aud) ? body.aud : [body.aud];
    if (!audiences.includes(this.config.resource)) return undefined;

    const tokenExpiryMs =
      typeof body.exp === "number" ? body.exp * 1000 : this.now() + CACHE_TTL_MS;
    if (tokenExpiryMs <= this.now()) return undefined;

    const verified: VerifiedToken = {
      apiKey: body.elfa_api_key,
      expiresAtMs: Math.min(tokenExpiryMs, this.now() + CACHE_TTL_MS),
    };
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(cacheKey, verified);
    return verified;
  }

  private async introspect(token: string): Promise<IntrospectionResponse> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.introspectionUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.introspectionToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
      });
    } catch (error) {
      throw new IntrospectionUnavailableError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) {
      throw new IntrospectionUnavailableError(
        `introspection returned HTTP ${response.status}`,
      );
    }
    try {
      return (await response.json()) as IntrospectionResponse;
    } catch {
      throw new IntrospectionUnavailableError("introspection returned invalid JSON");
    }
  }
}
