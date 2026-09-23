import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";
import {
  bearerChallenge,
  protectedResourceMetadataPath,
  TokenVerifier,
} from "../src/oauth.js";

const RESOURCE = "https://mcp.example.com/mcp";
const OAUTH_ENV = {
  ELFA_MCP_TRANSPORT: "http",
  ELFA_MCP_AUTH: "oauth",
  ELFA_MCP_RESOURCE_URL: RESOURCE,
  ELFA_OAUTH_ISSUER: "https://auth.example.com",
  ELFA_OAUTH_INTROSPECTION_URL: "http://auth.internal/introspect",
  ELFA_OAUTH_INTROSPECTION_TOKEN: "introspect-secret",
};

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  },
};

function introspection(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

const ACTIVE = {
  active: true,
  aud: RESOURCE,
  exp: Math.floor(Date.now() / 1000) + 3600,
  elfa_api_key: "elfak_from_grant",
};

describe("oauth config", () => {
  it("requires the resource-server settings", () => {
    expect(() =>
      loadConfig({ ELFA_MCP_TRANSPORT: "http", ELFA_MCP_AUTH: "oauth" }),
    ).toThrow(ConfigError);
  });

  it("is HTTP only", () => {
    expect(() =>
      loadConfig({ ...OAUTH_ENV, ELFA_MCP_TRANSPORT: "stdio" }),
    ).toThrow(/ELFA_MCP_TRANSPORT=http/);
  });

  it("ignores ELFA_API_KEY so a caller without a credential never inherits it", () => {
    const config = loadConfig({ ...OAUTH_ENV, ELFA_API_KEY: "server-key" });
    expect(config.apiKey).toBeUndefined();
    expect(config.oauth?.scopes).toEqual(["elfa"]);
  });

  it("leaves API-key mode unchanged", () => {
    const config = loadConfig({ ELFA_MCP_TRANSPORT: "http", ELFA_API_KEY: "k" });
    expect(config.auth).toBe("apikey");
    expect(config.apiKey).toBe("k");
    expect(config.oauth).toBeUndefined();
  });
});

describe("protected resource metadata helpers", () => {
  it("suffixes the resource path", () => {
    expect(protectedResourceMetadataPath(RESOURCE)).toBe(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(protectedResourceMetadataPath("https://x.example/")).toBe(
      "/.well-known/oauth-protected-resource",
    );
  });

  it("builds an RFC 6750 challenge naming the metadata", () => {
    const config = loadConfig(OAUTH_ENV).oauth!;
    expect(bearerChallenge(config)).toBe(
      'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="elfa"',
    );
    expect(
      bearerChallenge(config, { code: "invalid_token", description: "bad" }),
    ).toMatch(/^Bearer error="invalid_token", resource_metadata=/);
  });
});

describe("TokenVerifier", () => {
  const config = () => loadConfig(OAUTH_ENV).oauth!;

  it("returns the grant's key and caches it", async () => {
    const fetchImpl = introspection(ACTIVE);
    const verifier = new TokenVerifier(config(), fetchImpl as any);
    expect((await verifier.verify("tok"))?.apiKey).toBe("elfak_from_grant");
    expect((await verifier.verify("tok"))?.apiKey).toBe("elfak_from_grant");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer introspect-secret",
    );
  });

  it("re-checks after the cache window", async () => {
    let now = 1_000_000;
    const fetchImpl = introspection({ ...ACTIVE, exp: now / 1000 + 3600 });
    const verifier = new TokenVerifier(config(), fetchImpl as any, () => now);
    await verifier.verify("tok");
    now += 61_000;
    await verifier.verify("tok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects inactive tokens and tokens for another resource", async () => {
    await expect(
      new TokenVerifier(config(), introspection({ active: false }) as any).verify("t"),
    ).resolves.toBeUndefined();
    await expect(
      new TokenVerifier(
        config(),
        introspection({ ...ACTIVE, aud: "https://other.example/mcp" }) as any,
      ).verify("t"),
    ).resolves.toBeUndefined();
  });

  it("reports an unreachable authorization server as unavailable, not invalid", async () => {
    await expect(
      new TokenVerifier(config(), introspection({}, 502) as any).verify("t"),
    ).rejects.toThrow(/HTTP 502/);
  });
});

let server: http.Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = undefined;
});

async function listen(verifier: TokenVerifier): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const config = loadConfig({ ...OAUTH_ENV, ELFA_MCP_PORT: String(port) });
  server = http.createServer(createHttpApp(config, { verifier }));
  await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
  return port;
}

function request(
  port: number,
  method: "GET" | "POST",
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const data = method === "POST" ? JSON.stringify(INITIALIZE) : "";
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          host: `localhost:${port}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(data),
          ...headers,
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

describe("http transport in oauth mode", () => {
  const verifierWith = (fetchImpl: ReturnType<typeof introspection>) =>
    new TokenVerifier(loadConfig(OAUTH_ENV).oauth!, fetchImpl as any);

  it("serves protected-resource metadata at both well-known paths", async () => {
    const port = await listen(verifierWith(introspection(ACTIVE)));
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const res = await request(port, "GET", path);
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({
        resource: RESOURCE,
        authorization_servers: ["https://auth.example.com"],
        scopes_supported: ["elfa"],
      });
    }
  });

  it("challenges a request with no credential", async () => {
    const port = await listen(verifierWith(introspection(ACTIVE)));
    const res = await request(port, "POST", "/mcp");
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("serves a request with a valid bearer token", async () => {
    const fetchImpl = introspection(ACTIVE);
    const port = await listen(verifierWith(fetchImpl));
    const res = await request(port, "POST", "/mcp", {
      authorization: "Bearer elfa_at_good",
    });
    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("answers invalid_token for a bad bearer token", async () => {
    const port = await listen(verifierWith(introspection({ active: false })));
    const res = await request(port, "POST", "/mcp", {
      authorization: "Bearer elfa_at_bad",
    });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toMatch(/error="invalid_token"/);
  });

  it("answers 503, not 401, when introspection is down", async () => {
    const port = await listen(verifierWith(introspection({}, 500)));
    const res = await request(port, "POST", "/mcp", {
      authorization: "Bearer elfa_at_any",
    });
    expect(res.status).toBe(503);
    expect(res.headers["www-authenticate"]).toBeUndefined();
  });

  it("still accepts an x-elfa-api-key header without introspecting", async () => {
    const fetchImpl = introspection(ACTIVE);
    const port = await listen(verifierWith(fetchImpl));
    const res = await request(port, "POST", "/mcp", {
      "x-elfa-api-key": "elfak_header",
    });
    expect(res.status).toBe(200);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
