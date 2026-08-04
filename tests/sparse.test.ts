import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { Deps } from "../src/client.js";

function makeDeps(sdk: unknown): Deps {
  return { sdk: sdk as Deps["sdk"], hasHmac: true, maxResponseChars: 60000 };
}

async function call(sdk: unknown, name: string, args: Record<string, unknown>) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "probe", version: "1.0.0" });
  const server = createServer(makeDeps(sdk));
  await Promise.all([client.connect(ct), server.connect(st)]);
  const result = await client.callTool({ name, arguments: args });
  await server.close();
  return result;
}

describe("sparse API payloads", () => {
  it("chat without creditsConsumed", async () => {
    const sdk = { chat: async () => ({ success: true, data: { message: "hi", sessionId: "s1" } }) };
    const r = await call(sdk, "elfa_chat", { message: "hi" });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });

  it("auto build without planIds", async () => {
    const sdk = { auto: { chat: async () => ({ sessionId: "s", response: "r", title: null, reasoning: null }) } };
    const r = await call(sdk, "elfa_auto_build", { message: "watch btc" });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });

  it("trending without pagination echo", async () => {
    const sdk = { getTrendingTokens: async () => ({ success: true, data: { data: [{ token: "BTC", current_count: 1, previous_count: 0, change_percent: 0 }] } }) };
    const r = await call(sdk, "elfa_trending", {});
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });

  it("validate without cost estimate", async () => {
    const sdk = { auto: { validateQuery: async () => ({ valid: true }) } };
    const r = await call(sdk, "elfa_auto_validate", { query: { conditions: {}, actions: [], expiresIn: "24h" } });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });

  it("narratives when the payload is empty", async () => {
    const sdk = { getTrendingNarratives: async () => ({ success: true, data: {} }) };
    const r = await call(sdk, "elfa_narratives", {});
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });

  it("mentions when metadata is absent", async () => {
    const sdk = { getTopMentions: async () => ({ success: true, data: [] }) };
    const r = await call(sdk, "elfa_mentions", { mode: "top", ticker: "BTC" });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });

  it("account stats with a sparse body", async () => {
    const sdk = { getAccountSmartStats: async () => ({ success: true, data: {} }) };
    const r = await call(sdk, "elfa_account_stats", { username: "@x" });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });

  it("status when the key call fails", async () => {
    const sdk = { ping: async () => ({}), getApiKeyStatus: async () => { throw new Error("401"); } };
    const r = await call(sdk, "elfa_status", {});
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });
});

describe("argument defaults the API actually requires", () => {
  it("trending works with no arguments", async () => {
    let seen: Record<string, unknown> | undefined;
    const sdk = {
      getTrendingTokens: async (params: Record<string, unknown>) => {
        seen = params;
        if (!params.timeWindow && !(params.from && params.to)) {
          throw new Error("You must provide either timeWindow or both from and to parameters");
        }
        return { success: true, data: { page: 1, pageSize: 10, total: 0, data: [] } };
      },
    };
    const r = await call(sdk, "elfa_trending", {});
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(seen?.timeWindow).toBeTruthy();
  });

  it("trending does not force a window when an explicit range is given", async () => {
    let seen: Record<string, unknown> | undefined;
    const sdk = {
      getTrendingCAsTwitter: async (params: Record<string, unknown>) => {
        seen = params;
        return { success: true, data: { page: 1, pageSize: 10, total: 0, data: [] } };
      },
    };
    await call(sdk, "elfa_trending", { scope: "contracts_twitter", from: 1, to: 2 });
    expect(seen?.timeWindow).toBeUndefined();
  });
});

describe("limits the API enforces", () => {
  it("rejects more than five keywords before spending a credit", async () => {
    const sdk = { getKeywordMentions: async () => { throw new Error("should not be called"); } };
    const r = await call(sdk, "elfa_mentions", { mode: "search", keywords: "a,b,c,d,e,f" });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("at most 5");
  });

  it("rejects a search range outside the supported span", async () => {
    const sdk = { getKeywordMentions: async () => { throw new Error("should not be called"); } };
    const r = await call(sdk, "elfa_mentions", { mode: "search", keywords: "btc", from: 1000, to: 2000 });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("at least 1 day");
  });

  it("allows a valid search range", async () => {
    const sdk = { getKeywordMentions: async () => ({ success: true, data: [], metadata: { total: 0 } }) };
    const r = await call(sdk, "elfa_mentions", { mode: "search", keywords: "btc", from: 0, to: 172800 });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  });
});
