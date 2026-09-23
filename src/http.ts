import express from "express";
import type { NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildDeps, CredentialError } from "./client.js";
import type { ServerConfig } from "./config.js";
import { createServer } from "./server.js";
import {
  EntitlementCache,
  fetchEntitlements,
  type Entitlements,
} from "./entitlements.js";
import type { Deps } from "./client.js";
import {
  bearerChallenge,
  bearerToken,
  IntrospectionUnavailableError,
  protectedResourceMetadata,
  protectedResourceMetadataPath,
  TokenVerifier,
} from "./oauth.js";

const MCP_PATH = "/mcp";

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

/**
 * Hosts accepted when ELFA_MCP_ALLOWED_HOSTS is unset.
 *
 * DNS rebinding works by pointing an attacker-controlled hostname at the
 * loopback address, so the Host header is the only header that still carries
 * that hostname. Defaulting to the loopback names we actually bind keeps the
 * documented local run closed. Hosted deployments terminate on a public
 * domain and must set ELFA_MCP_ALLOWED_HOSTS.
 */
function defaultAllowedHosts(config: ServerConfig): string[] {
  const hosts = new Set<string>();
  for (const name of [config.host, "localhost", "127.0.0.1", "[::1]"]) {
    hosts.add(`${name}:${config.port}`);
    if (config.port === 80) hosts.add(name);
  }
  return [...hosts];
}

export interface HttpAppOptions {
  /** Injected in tests; built from config.oauth otherwise. */
  verifier?: TokenVerifier;
  /** Injected in tests; reads `/v2/key-status` otherwise. */
  entitlements?: (deps: Deps) => Promise<Entitlements | undefined>;
}

export function createHttpApp(
  config: ServerConfig,
  options: HttpAppOptions = {},
): express.Express {
  const app = express();
  const oauth = config.oauth;
  const verifier =
    options.verifier ?? (oauth ? new TokenVerifier(oauth) : undefined);
  const loadEntitlements = options.entitlements ?? fetchEntitlements;
  const entitlementCache = new EntitlementCache();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));
  app.use(
    (
      error: Error & { status?: number },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (error?.status === 400 || error instanceof SyntaxError) {
        jsonRpcError(res, 400, "Request body is not valid JSON.");
        return;
      }
      next(error);
    },
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  if (oauth) {
    // RFC 9728 metadata: where to get a token for this server. Served at the
    // path-suffixed location and at the root, which older clients probe.
    const sendMetadata = (_req: Request, res: Response) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.json(protectedResourceMetadata(oauth));
    };
    const metadataPath = protectedResourceMetadataPath(oauth.resource);
    app.get(metadataPath, sendMetadata);
    if (metadataPath !== "/.well-known/oauth-protected-resource") {
      app.get("/.well-known/oauth-protected-resource", sendMetadata);
    }
  }

  /**
   * The API key a request runs as. A request header wins, so API-key users of
   * a hosted server are unaffected by OAuth. In oauth mode a bearer token is
   * exchanged for its key by introspection; a request with neither gets the
   * challenge that starts the client's sign-in. Returns undefined when it has
   * already answered the request.
   */
  async function resolveApiKey(
    req: Request,
    res: Response,
  ): Promise<string | undefined | null> {
    const headerKey = header(req, "x-elfa-api-key");
    if (headerKey || !oauth || !verifier) return headerKey ?? null;

    const token = bearerToken(header(req, "authorization"));
    if (!token) {
      res.setHeader("WWW-Authenticate", bearerChallenge(oauth));
      jsonRpcError(res, 401, "Authorization required. Sign in to Elfa to use this server.");
      return undefined;
    }
    try {
      const verified = await verifier.verify(token);
      if (verified) return verified.apiKey;
    } catch (error) {
      if (error instanceof IntrospectionUnavailableError) {
        // Not a 401: that would send the client to sign in again for what is
        // an outage on our side.
        jsonRpcError(res, 503, "Authorization service unavailable, try again shortly.");
        return undefined;
      }
      throw error;
    }
    res.setHeader(
      "WWW-Authenticate",
      bearerChallenge(oauth, {
        code: "invalid_token",
        description: "The access token is invalid or expired",
      }),
    );
    jsonRpcError(res, 401, "Invalid or expired access token.");
    return undefined;
  }

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const origin = header(req, "origin");
    if (
      origin &&
      config.allowedOrigins.length > 0 &&
      !config.allowedOrigins.includes(origin)
    ) {
      jsonRpcError(res, 403, "Origin not allowed.");
      return;
    }

    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    try {
      const apiKey = await resolveApiKey(req, res);
      if (apiKey === undefined) return;
      const deps = buildDeps(config, { apiKey: apiKey ?? undefined });

      const entitlements = apiKey
        ? await entitlementCache.get(apiKey, () => loadEntitlements(deps))
        : undefined;

      server = createServer(deps, entitlements);
      transport = new StreamableHTTPServerTransport({
        enableDnsRebindingProtection: true,
        allowedHosts:
          config.allowedHosts.length > 0
            ? config.allowedHosts
            : defaultAllowedHosts(config),
        ...(config.allowedOrigins.length > 0
          ? { allowedOrigins: config.allowedOrigins }
          : {}),
      });

      res.on("close", () => {
        void transport?.close();
        void server?.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (error instanceof CredentialError) {
        jsonRpcError(res, 401, error.message);
        return;
      }
      if (!res.headersSent) {
        jsonRpcError(res, 500, "Internal server error.");
      }
    }
  });

  app.get(MCP_PATH, (_req, res) => {
    jsonRpcError(res, 405, "Method not allowed. This server is stateless, use POST.");
  });

  app.delete(MCP_PATH, (_req, res) => {
    jsonRpcError(res, 405, "Method not allowed. This server is stateless, use POST.");
  });

  return app;
}
