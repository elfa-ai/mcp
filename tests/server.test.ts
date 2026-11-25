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
    v3: { get: async () => ({}), send: async () => ({}) },
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
  it("registers exactly the tools listed in the manifest, in its order", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(
      manifest.tools.map((tool) => tool.name),
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

  it("titles every tool in its annotations and marks it either read-only or destructive", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    for (const tool of tools) {
      expect(tool.annotations?.title, tool.name).toBeTruthy();
      expect(tool.annotations?.title, tool.name).toBe(tool.title);
      const readOnly = tool.annotations?.readOnlyHint === true;
      const destructive = tool.annotations?.destructiveHint === true;
      expect(readOnly !== destructive, tool.name).toBe(true);
    }

    await server.close();
  });

  it("keeps draft and monitor reads and writes in separate tools", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    const methods = (name: string) => {
      const tool = tools.find((entry) => entry.name === name);
      const schema = tool?.inputSchema as {
        properties?: { method?: { enum?: string[] } };
      };
      return schema.properties?.method?.enum;
    };

    expect(methods("auto_draft")).toEqual(["list", "get"]);
    expect(methods("auto_draft_write")).toEqual(["upsert", "delete", "convert"]);
    expect(methods("monitors")).toEqual(["list", "get", "matches"]);
    expect(methods("monitors_write")).toEqual(["create", "update", "delete"]);

    await server.close();
  });

  it("marks the write tools as not read-only", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    const writers = tools
      .filter((tool) => tool.annotations?.readOnlyHint === false)
      .map((tool) => tool.name)
      .sort();

    expect(writers).toEqual(["auto_draft_write", "auto_query_write", "monitors_write"]);

    await server.close();
  });

  it("never accepts Elfa credentials as tool arguments", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    const banned = ["apikey", "apiKey", "elfaApiKey"];

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

  it("refuses Auto queries that carry a credential before calling the API", async () => {
    const { client, server } = await connect();
    const telegram = {
      conditions: { AND: [] },
      actions: [
        { stepId: "step_1", type: "telegram_bot", params: { botToken: "123:abc", chatId: "1" } },
      ],
      expiresIn: "24h",
    };
    const signedWebhook = {
      conditions: { AND: [] },
      actions: [
        {
          stepId: "step_1",
          type: "llm",
          params: { callback: { webhook: { url: "https://example.com", signingSecret: "s" } } },
        },
      ],
      expiresIn: "24h",
    };

    const calls = [
      { name: "auto_query_write", arguments: { method: "create", query: telegram } },
      { name: "auto_draft_write", arguments: { method: "upsert", query: telegram } },
      { name: "auto_validate", arguments: { method: "query", query: signedWebhook } },
    ];

    for (const call of calls) {
      const result = await client.callTool(call);
      expect(result.isError, call.name).toBe(true);
      expect(JSON.stringify(result.content), call.name).toContain("carries a credential");
    }

    await server.close();
  });

  it("marks only the tools bounded to the caller's own account as closed world", async () => {
    const { client, server } = await connect();
    const { tools } = await client.listTools();

    const closed = tools
      .filter((tool) => tool.annotations?.openWorldHint === false)
      .map((tool) => tool.name)
      .sort();

    expect(closed).toEqual(["api_status", "auto_draft", "auto_query", "auto_validate", "enterprise_docs"]);

    await server.close();
  });

  it("reports missing arguments as a recoverable tool error", async () => {
    const { client, server } = await connect();

    const result = await client.callTool({
      name: "mentions",
      arguments: { mode: "top" },
    });

    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("ticker");

    await server.close();
  });
});

describe("api_status", () => {
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
      v3: { get: async () => ({ historyFrom: 1788307200 }), send: async () => ({}) },
      maxResponseChars: 60000,
    });

    await Promise.all([client.connect(ct), server.connect(st)]);
    const result = await client.callTool({ name: "api_status", arguments: {} });
    const serialised = JSON.stringify(result);

    for (const secret of ["elfak_secret_value", "someone@example.com", "privy_did", "999"]) {
      expect(serialised.includes(secret), `leaked ${secret}`).toBe(false);
    }
    expect(serialised).toContain("payg");
    expect(result.structuredContent).toMatchObject({ historyFrom: 1788307200 });

    await server.close();
  });
});

describe("enterprise_docs", () => {
  const fragments = [
    {
      id: "f_552gftv3",
      title: "Token feed",
      markdown: "# Token feed\n",
      endpoints: [{ method: "GET", path: "/v2/token-feed", docsUrl: null }],
    },
    { id: "f_p7qqxbr6", title: "Insights", markdown: "# Insights\n", endpoints: [] },
  ];

  async function withDocs(get: (path: string) => Promise<Record<string, unknown>>) {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1.0.0" });
    const paths: string[] = [];
    const server = createServer({
      sdk: {} as unknown as Deps["sdk"],
      v3: {
        get: async (path: string) => {
          paths.push(path);
          return get(path);
        },
        send: async () => ({}),
      },
      maxResponseChars: 60000,
    });
    await Promise.all([client.connect(ct), server.connect(st)]);
    return { client, server, paths };
  }

  it("lists the key's docs without an id", async () => {
    const { client, server, paths } = await withDocs(async () => ({ success: true, data: { fragments } }));
    const result = await client.callTool({ name: "enterprise_docs", arguments: {} });
    expect(paths).toEqual(["/v2/docs/enterprise"]);
    expect(result.structuredContent).toEqual({
      docs: [
        { id: "f_552gftv3", title: "Token feed", method: "GET", path: "/v2/token-feed" },
        { id: "f_p7qqxbr6", title: "Insights", method: null, path: null },
      ],
    });
    await server.close();
  });

  it("returns one doc's markdown and endpoints for an id", async () => {
    const { client, server } = await withDocs(async () => ({ success: true, data: { fragments } }));
    const result = await client.callTool({ name: "enterprise_docs", arguments: { id: "f_552gftv3" } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ doc: fragments[0] });
    await server.close();
  });

  it("says so when the id is not one of the key's docs", async () => {
    const { client, server } = await withDocs(async () => ({ success: true, data: { fragments } }));
    const result = await client.callTool({ name: "enterprise_docs", arguments: { id: "f_aaaaaaaa" } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("without an id");
    await server.close();
  });

  it("is an empty list for a key with no enterprise docs", async () => {
    const { client, server } = await withDocs(async () => ({ success: true, data: { fragments: [] } }));
    const result = await client.callTool({ name: "enterprise_docs", arguments: {} });
    expect(result.structuredContent).toEqual({ docs: [] });
    await server.close();
  });

  it("reports an API failure as a tool error", async () => {
    const { client, server } = await withDocs(async () => {
      throw Object.assign(new Error("Enterprise docs are unavailable right now"), { statusCode: 503 });
    });
    const result = await client.callTool({ name: "enterprise_docs", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("unavailable");
    await server.close();
  });
});
