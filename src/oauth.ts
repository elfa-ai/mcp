import { createHash } from "node:crypto";
import type { OAuthConfig } from "./config.js";

/**
 * OAuth resource-server side of the HTTP transport (MCP authorization spec).
 *
 * The server does not issue or parse tokens. It advertises its authorization
 * server through RFC 9728 protected-resource metadata, answers unauthenticated
 * requests with a `WWW-Authenticate` challenge that points there, and checks
 * each bearer token with the authorization server's introspection endpoint.
 *
 * The client's token is never forwarded to the Elfa API: its audience is this
 * server. For each valid token the server gets a short-lived token of its own
 * for the Elfa API (RFC 8693 token exchange) and calls the API with that. If
 * the exchange is not available and introspection returned the grant's API
 * key, it calls with the key instead.
 */

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 10_000;
const INTROSPECTION_TIMEOUT_MS = 5_000;
/** Exchange again this long before the API token expires. */
const API_TOKEN_REFRESH_MARGIN_MS = 60_000;
const TOKEN_EXCHANGE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

export class IntrospectionUnavailableError extends Error {}

/** How a request calls the Elfa API: an exchanged token, or a key. */
export type ApiCredentials = { accessToken: string } | { apiKey: string };

export interface VerifiedToken {
  credentials: ApiCredentials;
  /** Stable per connection (the grant), for caches that should outlive a token. */
  subject: string;
  expiresAtMs: number;
}

interface Introspected {
  apiKey: string | undefined;
  grantId: number | undefined;
  tokenExpiryMs: number;
  /** When this introspection answer must be checked again. */
  checkAgainAtMs: number;
}

/**
 * The token exchange endpoint, next to introspection on the authorization
 * server: `…/introspect` becomes `…/token-exchange`.
 */
export function tokenExchangeUrl(introspectionUrl: string): string {
  return introspectionUrl.replace(/\/introspect\/?$/, "/token-exchange");
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
    resource_documentation: "https://docs.elfa.ai/integrations/mcp",
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
  elfa_grant_id?: number;
}

interface ExchangeResponse {
  access_token?: string;
  expires_in?: number;
}

type ExchangeResult =
  | { ok: true; accessToken: string; expiresAtMs: number }
  | { ok: false; invalid: boolean; reason: string };

/**
 * Checks bearer tokens by introspection, caching good answers for up to a
 * minute (or until the token expires, if sooner). That minute bounds how long a
 * revoked token keeps working here. For a valid token it then returns the
 * credentials to call the Elfa API with: an exchanged API token, cached until
 * shortly before it expires but only used while the introspection answer is
 * fresh, or the grant's key when the exchange is unavailable.
 */
export class TokenVerifier {
  private readonly introspected = new Map<string, Introspected>();
  private readonly apiTokens = new Map<string, { accessToken: string; expiresAtMs: number }>();
  /** After an outage-type exchange failure, use the key path until then. */
  private exchangeBackoffUntilMs = 0;

  constructor(
    private readonly config: OAuthConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
    private readonly warn: (line: string) => void = (line) =>
      process.stderr.write(`${line}\n`),
  ) {}

  /** Credentials for a valid token, or undefined when the token is not valid. */
  async verify(token: string): Promise<VerifiedToken | undefined> {
    const cacheKey = createHash("sha256").update(token).digest("hex");
    const info = await this.introspectCached(cacheKey, token);
    if (!info) {
      this.apiTokens.delete(cacheKey);
      return undefined;
    }
    const subject =
      info.grantId !== undefined ? `grant:${info.grantId}` : `token:${cacheKey}`;

    const cached = this.apiTokens.get(cacheKey);
    if (cached && cached.expiresAtMs - API_TOKEN_REFRESH_MARGIN_MS > this.now()) {
      return {
        credentials: { accessToken: cached.accessToken },
        subject,
        expiresAtMs: info.checkAgainAtMs,
      };
    }

    const exchanged: ExchangeResult =
      this.exchangeBackoffUntilMs > this.now() && info.apiKey
        ? { ok: false, invalid: false, reason: "backing off" }
        : await this.exchange(token);
    if (!exchanged.ok && !exchanged.invalid && exchanged.reason !== "backing off") {
      this.exchangeBackoffUntilMs = this.now() + CACHE_TTL_MS;
    }
    if (exchanged.ok) {
      this.exchangeBackoffUntilMs = 0;
      setBounded(this.apiTokens, cacheKey, {
        accessToken: exchanged.accessToken,
        expiresAtMs: exchanged.expiresAtMs,
      });
      return {
        credentials: { accessToken: exchanged.accessToken },
        subject,
        expiresAtMs: info.checkAgainAtMs,
      };
    }
    this.apiTokens.delete(cacheKey);
    if (info.apiKey) {
      // The authorization server predates the exchange, or it failed: the
      // grant's key still works while introspection returns it.
      return { credentials: { apiKey: info.apiKey }, subject, expiresAtMs: info.checkAgainAtMs };
    }
    if (exchanged.invalid) {
      // Revoked between introspection and exchange.
      this.introspected.delete(cacheKey);
      return undefined;
    }
    throw new IntrospectionUnavailableError(`token exchange failed: ${exchanged.reason}`);
  }

  private async introspectCached(
    cacheKey: string,
    token: string,
  ): Promise<Introspected | undefined> {
    const cached = this.introspected.get(cacheKey);
    if (cached && cached.checkAgainAtMs > this.now()) return cached;
    if (cached) this.introspected.delete(cacheKey);

    const body = await this.introspect(token);
    if (!body.active) return undefined;

    // The token must have been issued for THIS server (RFC 8707). The
    // authorization server serves other resources too.
    const audiences = Array.isArray(body.aud) ? body.aud : [body.aud];
    if (!audiences.includes(this.config.resource)) return undefined;

    const tokenExpiryMs =
      typeof body.exp === "number" ? body.exp * 1000 : this.now() + CACHE_TTL_MS;
    if (tokenExpiryMs <= this.now()) return undefined;

    const info: Introspected = {
      apiKey: typeof body.elfa_api_key === "string" ? body.elfa_api_key : undefined,
      grantId: typeof body.elfa_grant_id === "number" ? body.elfa_grant_id : undefined,
      tokenExpiryMs,
      checkAgainAtMs: Math.min(tokenExpiryMs, this.now() + CACHE_TTL_MS),
    };
    setBounded(this.introspected, cacheKey, info);
    return info;
  }

  private async exchange(token: string): Promise<ExchangeResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(tokenExchangeUrl(this.config.introspectionUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.introspectionToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
          subject_token: token,
          subject_token_type: ACCESS_TOKEN_TYPE,
          audience: this.config.issuer,
        }),
        signal: AbortSignal.timeout(INTROSPECTION_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.warn(`token exchange unavailable: ${reason}`);
      return { ok: false, invalid: false, reason };
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      const reason = `HTTP ${response.status}${body.error ? ` ${body.error}` : ""}`;
      if (body.error !== "invalid_grant") this.warn(`token exchange failed: ${reason}`);
      return { ok: false, invalid: body.error === "invalid_grant", reason };
    }
    const body = (await response.json().catch(() => ({}))) as ExchangeResponse;
    if (typeof body.access_token !== "string" || typeof body.expires_in !== "number") {
      this.warn("token exchange returned an unexpected body");
      return { ok: false, invalid: false, reason: "unexpected body" };
    }
    return {
      ok: true,
      accessToken: body.access_token,
      expiresAtMs: this.now() + body.expires_in * 1000,
    };
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

function setBounded<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}
