import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { Deps } from "../src/client.js";
import {
  EntitlementCache,
  fetchEntitlements,
  hasScope,
  UPGRADE_URL,
} from "../src/entitlements.js";

function deps(sdk: Partial<Deps["sdk"]> = {}): Deps {
  return { sdk: sdk as Deps["sdk"], maxResponseChars: 60000 };
}

async function connect(d: Deps, scopes?: string[]) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  const server = createServer(d, scopes ? { scopes } : undefined);
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

describe("hasScope", () => {
  it("matches like oracle: exact, star, and prefix families", () => {
    expect(hasScope(["chat"], "chat")).toBe(true);
    expect(hasScope(["chat/stream"], "chat")).toBe(false);
    expect(hasScope(["*"], "chat")).toBe(true);
    expect(hasScope(["events/*"], "events/arcs")).toBe(true);
    expect(hasScope(["events/*"], "events")).toBe(false);
  });
});

describe("plan-gated tools", () => {
  it("lists market_chat with the upgrade path and never calls the API", async () => {
    const chat = vi.fn();
    const client = await connect(deps({ chat } as never), ["key-status", "data/top-mentions"]);

    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "market_chat");
    expect(tool?.description).toMatch(/^Requires a higher-tier plan than this API key has/);
    expect(tool?.description).toContain(UPGRADE_URL);

    const result = await client.callTool({
      name: "market_chat",
      arguments: { analysisType: "chat", message: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("requires a higher-tier plan");
    expect(chat).not.toHaveBeenCalled();
  });

  it("leaves market_chat alone for a key with the chat scope", async () => {
    const client = await connect(deps(), ["key-status", "chat"]);
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "market_chat")?.description).not.toMatch(/higher-tier plan/);
  });

  it("leaves every tool alone when the scopes are unknown", async () => {
    const client = await connect(deps());
    const { tools } = await client.listTools();
    expect(tools.some((t) => t.description?.startsWith("Requires a higher-tier plan"))).toBe(false);
  });
});

describe("fetchEntitlements", () => {
  it("returns the key's scopes", async () => {
    const d = deps({ getApiKeyStatus: async () => ({ data: { scopes: ["chat"] } }) } as never);
    await expect(fetchEntitlements(d)).resolves.toEqual({ scopes: ["chat"] });
  });

  it("fails open on an error or a response without scopes", async () => {
    const failing = deps({ getApiKeyStatus: async () => { throw new Error("401"); } } as never);
    await expect(fetchEntitlements(failing)).resolves.toBeUndefined();
    const empty = deps({ getApiKeyStatus: async () => ({ data: {} }) } as never);
    await expect(fetchEntitlements(empty)).resolves.toBeUndefined();
  });

  it("gives up after the lookup timeout", async () => {
    vi.useFakeTimers();
    try {
      const d = deps({ getApiKeyStatus: () => new Promise(() => {}) } as never);
      const pending = fetchEntitlements(d);
      await vi.advanceTimersByTimeAsync(3_001);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("EntitlementCache", () => {
  it("caches an answer per key for a minute and never caches a failure", async () => {
    let now = 0;
    const cache = new EntitlementCache(() => now);
    const load = vi.fn(async () => ({ scopes: ["chat"] }));
    await cache.get("k1", load);
    await cache.get("k1", load);
    expect(load).toHaveBeenCalledTimes(1);
    now += 61_000;
    await cache.get("k1", load);
    expect(load).toHaveBeenCalledTimes(2);

    const miss = vi.fn(async () => undefined);
    await cache.get("k2", miss);
    await cache.get("k2", miss);
    expect(miss).toHaveBeenCalledTimes(2);
  });
});

describe("http transport", () => {
  it("looks up the calling key's scopes and locks what they don't cover", async () => {
    const { default: http } = await import("node:http");
    const { createHttpApp } = await import("../src/http.js");
    const { loadConfig } = await import("../src/config.js");

    const probe = http.createServer();
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((r) => probe.close(() => r()));

    const seen: string[] = [];
    const config = loadConfig({ ELFA_MCP_TRANSPORT: "http", ELFA_MCP_PORT: String(port) });
    const app = createHttpApp(config, {
      entitlements: async () => {
        seen.push("lookup");
        return { scopes: ["key-status"] };
      },
    });
    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
      const text = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/mcp",
            method: "POST",
            headers: {
              host: `localhost:${port}`,
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              "x-elfa-api-key": "free-tier-key",
              "content-length": Buffer.byteLength(body),
            },
          },
          (res) => {
            let out = "";
            res.on("data", (c) => (out += c));
            res.on("end", () => resolve(out));
          },
        );
        req.on("error", reject);
        req.end(body);
      });
      expect(seen).toHaveLength(1);
      expect(text).toContain("Requires a higher-tier plan");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
