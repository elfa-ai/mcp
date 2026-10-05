import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import pkg from "../package.json" with { type: "json" };
import { buildDeps, identifyClientOnInitialize, type Deps } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";
import { createServer } from "../src/server.js";
import { sanitizeClient, userAgent } from "../src/userAgent.js";

const VERSION = pkg.version;

function agentOf(deps: Deps): string | undefined {
  const headers = deps.sdk.getOptions().headers ?? {};
  const names = Object.keys(headers).filter((name) => name.toLowerCase() === "user-agent");
  expect(names).toHaveLength(1);
  return headers[names[0]!];
}

describe("userAgent", () => {
  it("names the product, version and transport", () => {
    expect(userAgent("stdio")).toBe(`elfa-mcp/${VERSION} (stdio)`);
    expect(userAgent("http")).toBe(`elfa-mcp/${VERSION} (http)`);
  });

  it("adds the connecting client", () => {
    expect(userAgent("http", "claude-code/2.0.1")).toBe(
      `elfa-mcp/${VERSION} (http; client=claude-code/2.0.1)`,
    );
  });

  it("drops an empty client", () => {
    expect(userAgent("http", " \t ")).toBe(`elfa-mcp/${VERSION} (http)`);
  });
});

describe("sanitizeClient", () => {
  it("strips control and non-ASCII characters and collapses whitespace", () => {
    expect(sanitizeClient("Cursor\r\n x-injected:\t1 ✨")).toBe("Cursor x-injected: 1");
  });

  it("turns comment delimiters into spaces so the outer comment stays parseable", () => {
    expect(sanitizeClient("Mozilla/5.0 (Macintosh; Intel) x\\y")).toBe(
      "Mozilla/5.0 Macintosh Intel x y",
    );
  });

  it("caps the value at 100 characters", () => {
    expect(sanitizeClient("a".repeat(150))).toHaveLength(100);
  });

  it("returns undefined for nothing usable", () => {
    expect(sanitizeClient(undefined)).toBeUndefined();
    expect(sanitizeClient("\u0000\u0007")).toBeUndefined();
  });
});

describe("buildDeps", () => {
  it("sends the MCP User-Agent next to ELFA_EXTRA_HEADERS", () => {
    const config = loadConfig({
      ELFA_API_KEY: "k",
      ELFA_EXTRA_HEADERS: JSON.stringify({ "x-staging-secret": "s" }),
    });
    const deps = buildDeps(config);

    expect(agentOf(deps)).toBe(`elfa-mcp/${VERSION} (stdio)`);
    expect(deps.sdk.getOptions().headers?.["x-staging-secret"]).toBe("s");
  });

  it("tags the client when one is given", () => {
    const config = loadConfig({ ELFA_API_KEY: "k", ELFA_MCP_TRANSPORT: "http" });

    expect(agentOf(buildDeps(config, { client: "ChatGPT/1.0" }))).toBe(
      `elfa-mcp/${VERSION} (http; client=ChatGPT/1.0)`,
    );
  });

  it("leaves the User-Agent to an operator-set header in any casing", () => {
    const config = loadConfig({
      ELFA_API_KEY: "k",
      ELFA_EXTRA_HEADERS: JSON.stringify({ "user-agent": "ops/1" }),
    });

    expect(agentOf(buildDeps(config, { client: "x/1" }))).toBe("ops/1");
  });
});

describe("stdio client identity", () => {
  it("rebuilds the SDK with the client's name and version after initialize", async () => {
    const config = loadConfig({ ELFA_API_KEY: "k" });
    const deps = buildDeps(config);
    const before = deps.sdk;
    const server = createServer(deps);
    identifyClientOnInitialize(server, deps, config);

    const initialized = new Promise<void>((resolve) => {
      const original = server.server.oninitialized;
      server.server.oninitialized = () => {
        original?.();
        resolve();
      };
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "e2e-client", version: "1.2.3" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    await initialized;

    expect(deps.sdk).not.toBe(before);
    expect(agentOf(deps)).toBe(`elfa-mcp/${VERSION} (stdio; client=e2e-client/1.2.3)`);
    await client.close();
  });
});

describe("http client identity", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = undefined;
  });

  async function start(): Promise<{ port: number; seen: Deps[]; logs: string[] }> {
    const probe = http.createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const seen: Deps[] = [];
    const logs: string[] = [];
    const config = loadConfig({ ELFA_MCP_TRANSPORT: "http", ELFA_MCP_PORT: String(port) });
    const app = createHttpApp(config, {
      entitlements: async (deps) => {
        seen.push(deps);
        return undefined;
      },
      log: (line) => logs.push(line),
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
    return { port, seen, logs };
  }

  function post(
    port: number,
    body: unknown,
    userAgent: string,
    extra: Record<string, string> = {},
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            host: `127.0.0.1:${port}`,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "content-length": Buffer.byteLength(data),
            "x-elfa-api-key": "k",
            "user-agent": userAgent,
            ...extra,
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        },
      );
      req.on("error", reject);
      req.end(data);
    });
  }

  const initialize = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "claude-ai", version: "0.1.0\n" },
    },
  };

  it("forwards the caller's User-Agent and logs the handshake", async () => {
    const { port, seen, logs } = await start();

    expect(await post(port, initialize, "claude-code/2.0.1")).toBe(200);

    expect(seen).toHaveLength(1);
    expect(agentOf(seen[0]!)).toBe(`elfa-mcp/${VERSION} (http; client=claude-code/2.0.1)`);
    expect(logs.map((line) => JSON.parse(line))).toEqual([
      { event: "initialize", client: { name: "claude-ai", version: "0.1.0" } },
    ]);
  });

  it("logs nothing for a batched initialize the transport rejects", async () => {
    const { port, logs } = await start();
    const notification = { jsonrpc: "2.0", method: "notifications/cancelled", params: {} };

    expect(await post(port, [notification, initialize], "claude-code/2.0.1")).toBe(400);

    expect(logs).toEqual([]);
  });

  it("logs nothing for an initialize refused on the Host check", async () => {
    const { port, logs } = await start();

    expect(await post(port, initialize, "claude-code/2.0.1", { host: "evil.example" })).toBe(403);

    expect(logs).toEqual([]);
  });

  it("logs nothing for messages other than initialize", async () => {
    const { port, seen, logs } = await start();

    await post(port, { jsonrpc: "2.0", id: 2, method: "tools/list" }, "claude-code/2.0.1");

    expect(seen).toHaveLength(1);
    expect(logs).toEqual([]);
  });
});
