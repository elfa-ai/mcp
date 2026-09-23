import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";

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

let server: http.Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
  server = undefined;
});

async function freePort(): Promise<number> {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

// The server must bind the port it was configured with, because the default
// host allowlist is derived from that port.
async function listen(env: NodeJS.ProcessEnv): Promise<number> {
  const port = await freePort();
  const config = loadConfig({
    ELFA_MCP_TRANSPORT: "http",
    ELFA_API_KEY: "test-key",
    ELFA_MCP_PORT: String(port),
    ...env,
  });
  const app = createHttpApp(config, { entitlements: async () => undefined });
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(port, "127.0.0.1", resolve));
  return port;
}

function post(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(INITIALIZE);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          host,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "content-length": Buffer.byteLength(data),
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

describe("dns rebinding protection", () => {
  it("rejects a rebound Host on the documented local run", async () => {
    const port = await listen({});
    expect(await post(port, `attacker.example:${port}`)).toBe(403);
  });

  it("accepts the loopback hosts it binds", async () => {
    const port = await listen({});
    expect(await post(port, `127.0.0.1:${port}`)).not.toBe(403);
    expect(await post(port, `localhost:${port}`)).not.toBe(403);
  });

  it("accepts a public domain only when ELFA_MCP_ALLOWED_HOSTS lists it", async () => {
    const port = await listen({ ELFA_MCP_ALLOWED_HOSTS: "mcp.elfa.ai" });
    expect(await post(port, "mcp.elfa.ai")).not.toBe(403);
    expect(await post(port, `attacker.example:${port}`)).toBe(403);
  });
});
