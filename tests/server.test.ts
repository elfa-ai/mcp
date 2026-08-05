import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "../src/server.js";
import type { Deps } from "../src/client.js";

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../manifest.json"), "utf8"),
) as { tools: Array<{ name: string }> };

function deps(): Deps {
  return {
    sdk: {} as Deps["sdk"],
    hasHmac: false,
    maxResponseChars: 60000,
  };
}

async function connect() {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  const server = createServer(deps());

  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);

  return { client, server };
}

describe("server", () => {
  it("registers exactly the tools listed in the manifest", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      manifest.tools.map((tool) => tool.name).sort(),
    );

    await server.close();
  });

  it("gives every tool a description, an output schema and full annotations", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.description, tool.name).toBeTruthy();
      expect(tool.outputSchema, tool.name).toBeTruthy();
      expect(tool.annotations, tool.name).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
    }

    await server.close();
  });

  it("marks the write tools as not read-only", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    const writers = tools
      .filter((tool) => tool.annotations?.readOnlyHint === false)
      .map((tool) => tool.name)
      .sort();

    expect(writers).toEqual([
      "elfa_auto_draft",
      "elfa_auto_exchanges",
      "elfa_auto_query_write",
    ]);

    await server.close();
  });

  it("never accepts Elfa credentials as tool arguments", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    const banned = ["apikey", "apiKey", "hmac", "hmacsecret", "elfaApiKey"];

    for (const tool of tools) {
      const properties = Object.keys(
        (tool.inputSchema as { properties?: Record<string, unknown> })
          .properties ?? {},
      );
      for (const property of properties) {
        expect(
          banned.some((entry) => property.toLowerCase() === entry.toLowerCase()),
          `${tool.name}.${property}`,
        ).toBe(false);
      }
    }

    await server.close();
  });

  it("reports missing arguments as a recoverable tool error", async () => {
    const { client, server } = await connect();

    const result = await client.callTool({
      name: "elfa_mentions",
      arguments: { mode: "top" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("ticker");

    await server.close();
  });

  it("refuses order-placing queries when no signing secret is configured", async () => {
    const { client, server } = await connect();

    const result = await client.callTool({
      name: "elfa_auto_query_write",
      arguments: {
        method: "create",
        query: {
          conditions: { AND: [] },
          actions: [{ stepId: "s1", type: "market_order", params: {} }],
          expiresIn: "24h",
        },
      },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("ELFA_HMAC_SECRET");

    await server.close();
  });
});

describe("elfa_status", () => {
  it("never returns the api key, contact details or internal identifiers", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    const server = createServer({
      sdk: {
        ping: async () => ({ success: true, data: { message: "ok" } }),
        getApiKeyStatus: async () => ({
          success: true,
          data: {
            key: "elfak_secret_value",
            email: "someone@example.com",
            userId: 999,
            name: "privy_did:privy:abc123",
            id: 42,
            tier: "payg",
            status: "active",
            usage: { daily: 1, monthly: 2 },
          },
        }),
      } as unknown as Deps["sdk"],
      hasHmac: false,
      maxResponseChars: 60000,
    });

    await Promise.all([client.connect(ct), server.connect(st)]);
    const result = await client.callTool({ name: "elfa_status", arguments: {} });
    const serialised = JSON.stringify(result);

    for (const secret of ["elfak_secret_value", "someone@example.com", "privy_did", "999"]) {
      expect(serialised.includes(secret), `leaked ${secret}`).toBe(false);
    }
    expect(serialised).toContain("payg");

    await server.close();
  });
});
