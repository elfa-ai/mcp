import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { Deps } from "../src/client.js";
import { describeError } from "../src/errors.js";
import { toResult } from "../src/shape.js";
import { createV3Client, queryString, V3ApiError, V3RedirectError, type V3Params } from "../src/v3.js";

type Get = (path: string, params?: V3Params) => Promise<Record<string, unknown>>;

async function call(get: Get, name: string, args: Record<string, unknown>, scopes?: string[]) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "probe", version: "1.0.0" });
  const server = createServer(
    { sdk: {} as Deps["sdk"], v3: { get }, maxResponseChars: 60000 },
    scopes ? { scopes } : undefined,
  );
  await Promise.all([client.connect(ct), server.connect(st)]);
  const result = await client.callTool({ name, arguments: args });
  await server.close();
  return result as { isError?: boolean; content: unknown; structuredContent?: Record<string, unknown> };
}

const list = (key: string) => async (_path: string, _params?: V3Params) => ({
  [key]: [{ id: "a" }],
  nextCursor: "next",
  hasMore: true,
  servedFrom: 1790672305,
});

describe("queryString", () => {
  it("joins lists with commas and drops undefined", () => {
    expect(queryString({ entityIds: ["a", "b"], from: 1, hasStoryline: true, q: undefined })).toBe(
      "?entityIds=a%2Cb&from=1&hasStoryline=true",
    );
    expect(queryString({ entityIds: [] })).toBe("");
  });
});

describe("v3 client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the key and the extra headers, and returns the body", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createV3Client({
      apiKey: "k",
      baseUrl: "https://api.example/",
      timeout: 1000,
      retries: 0,
      headers: { "User-Agent": "elfa-mcp/test" },
    });

    await expect(client.get("/v3/entities", { q: "btc" })).resolves.toEqual({ ok: 1 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v3/entities?q=btc");
    expect(init.headers).toMatchObject({ "x-elfa-api-key": "k", "User-Agent": "elfa-mcp/test" });
    expect(init.redirect).toBe("error");
  });

  it("raises the API message and details with the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            code: "ERR_BAD_REQUEST",
            message: "from is required",
            details: [{ field: "from" }],
            requestId: "req-42",
          }),
          { status: 400 },
        ),
      ),
    );
    const client = createV3Client({ apiKey: "k", timeout: 1000, retries: 0 });

    const error = await client.get("/v3/calls").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(V3ApiError);
    expect((error as V3ApiError).statusCode).toBe(400);
    expect(describeError(error)).toContain("from is required");
    expect(describeError(error)).toContain("Request rejected as invalid");
    expect(describeError(error)).toContain("(requestId req-42)");
  });

  it("names the rate-limit reset on a 429 and explains a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "Too many requests" }), {
          status: 429,
          headers: { "RateLimit-Reset": "42" },
        }),
      ),
    );
    const client = createV3Client({ apiKey: "k", timeout: 1000, retries: 0 });
    const limited = await client.get("/v3/events").catch((e: unknown) => e);
    expect(describeError(limited)).toContain("Resets in 42 seconds");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: "ERR_RATE_LIMITED", message: "Out of credits" }), {
          status: 429,
        }),
      ),
    );
    const spent = await client.get("/v3/events").catch((e: unknown) => e);
    expect(describeError(spent)).toContain("retrying will not help");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      }),
    );
    const slow = await client.get("/v3/events").catch((e: unknown) => e);
    expect(describeError(slow)).toContain("did not answer within 1000 ms");
    const capped = await client.get("/v3/events", {}, { timeout: 250 }).catch((e: unknown) => e);
    expect(describeError(capped)).toContain("did not answer within 250 ms");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const response = new Response("{}", { status: 200 });
        vi.spyOn(response, "json").mockRejectedValue(
          new DOMException("The operation was aborted due to timeout", "TimeoutError"),
        );
        return response;
      }),
    );
    const stalled = await client.get("/v3/events").catch((e: unknown) => e);
    expect(describeError(stalled)).toContain("did not answer within 1000 ms");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
      }),
    );
    const redirected = await client.get("/v3/events").catch((e: unknown) => e);
    expect(describeError(redirected)).toContain("Check that ELFA_BASE_URL, if set, is the https API origin");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed", {
          cause: Object.assign(new AggregateError([new Error("connect ECONNREFUSED ::1:443")], ""), {
            code: "ECONNREFUSED",
          }),
        });
      }),
    );
    const refused = await client.get("/v3/events").catch((e: unknown) => e);
    expect(describeError(refused)).toBe("Could not reach the Elfa API: ECONNREFUSED.");
  });

  it("never retries a refused redirect", async () => {
    const redirect = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("unexpected redirect") });
    });
    vi.stubGlobal("fetch", redirect);
    const client = createV3Client({ apiKey: "k", timeout: 1000, retries: 2 });
    await expect(client.get("/v3/events")).rejects.toBeInstanceOf(V3RedirectError);
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx but never a 4xx", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createV3Client({ apiKey: "k", timeout: 1000, retries: 1 });

    const pending = client.get("/v3/events");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const once = vi.fn(async () => new Response("{}", { status: 400 }));
    vi.stubGlobal("fetch", once);
    await expect(client.get("/v3/events")).rejects.toBeInstanceOf(V3ApiError);
    expect(once).toHaveBeenCalledTimes(1);

    const down = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", down);
    await expect(client.get("/v3/events", {}, { retries: 0 })).rejects.toBeInstanceOf(V3ApiError);
    expect(down).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("v3 tools", () => {
  it("entities resolves through /v3/entities", async () => {
    const get = vi.fn(list("entities"));
    const r = await call(get, "entities", { q: "btc", entityType: ["token"] });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(get).toHaveBeenCalledWith("/v3/entities", { q: "btc", entityType: ["token"], limit: 10, cursor: undefined });
    expect(r.structuredContent).toMatchObject({ items: [{ id: "a" }], nextCursor: "next", hasMore: true });
    expect(r.structuredContent?.notice).toMatch(/third-party/i);
  });

  it("events maps each level to its path, list key and ids parameter", async () => {
    for (const [level, path, ids] of [
      ["events", "/v3/events", "eventIds"],
      ["storylines", "/v3/events/storylines", "storylineIds"],
      ["arcs", "/v3/events/arcs", "arcIds"],
    ] as const) {
      const get = vi.fn(list(level));
      const r = await call(get, "events", { level, ids: ["x"] });
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
      const [calledPath, params] = get.mock.calls[0] as unknown as [string, V3Params];
      expect(calledPath).toBe(path);
      expect(params[ids]).toEqual(["x"]);
      expect(params.limit).toBeUndefined();
      expect(r.structuredContent).toMatchObject({ level, items: [{ id: "a" }], servedFrom: 1790672305 });
      expect(r.structuredContent?.notice).toMatch(/untrusted|third-party/i);
    }
  });

  it("market reads the chosen view and market", async () => {
    const get = vi.fn(list("bars"));
    const r = await call(get, "market", { view: "call_book", market: "equity", from: 1790845105 });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(get.mock.calls[0]?.[0]).toBe("/v3/market/equity/call-book");

    const mindshare = vi.fn(list("assets"));
    await call(mindshare, "market", {});
    expect(mindshare).toHaveBeenCalledWith("/v3/market/crypto/mindshare", {
      period: undefined,
      from: undefined,
      to: undefined,
      minMentions: undefined,
      order: undefined,
      limit: 10,
      cursor: undefined,
    });

    const contracts = vi.fn(list("contracts"));
    const c = await call(contracts, "market", { view: "trending_contracts", from: 1790845105 });
    expect(contracts.mock.calls[0]?.[0]).toBe("/v3/market/crypto/trending-contracts");
    expect(c.structuredContent).toMatchObject({ items: [{ id: "a" }] });
  });

  it("market refuses what the API would refuse, without a call", async () => {
    const get = vi.fn(list("bars"));
    expect((await call(get, "market", { view: "call_book" })).isError).toBe(true);
    expect((await call(get, "market", { view: "trending_contracts", market: "equity", from: 1 })).isError).toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it("calls maps levels, strips the at sign and needs entityId for positioning", async () => {
    const get = vi.fn(list("episodes"));
    const r = await call(get, "calls", { level: "episodes", handle: "@3PeaksTrading", status: "open", from: 1 });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const [path, params] = get.mock.calls[0] as unknown as [string, V3Params];
    expect(path).toBe("/v3/calls/episodes");
    expect(params.handle).toBe("3PeaksTrading");

    expect(r.structuredContent?.notice).toMatch(/third-party/i);

    const emptyIds = vi.fn(list("calls"));
    expect((await call(emptyIds, "calls", { ids: [], from: 1 })).isError).toBe(true);
    expect((await call(emptyIds, "events", { entityIds: [], from: 1 })).isError).toBe(true);
    expect(emptyIds).not.toHaveBeenCalled();

    const byId = vi.fn(list("calls"));
    await call(byId, "calls", { ids: ["c1", "c2"] });
    const [, byIdParams] = byId.mock.calls[0] as unknown as [string, V3Params];
    expect(byIdParams.callIds).toEqual(["c1", "c2"]);
    expect(byIdParams.limit).toBeUndefined();

    const missing = vi.fn();
    expect((await call(missing, "calls", { level: "positioning" })).isError).toBe(true);
    expect(missing).not.toHaveBeenCalled();

    const positioning = vi.fn(async () => ({ id: "btc", openLong: 3, openShort: 1, asOf: 1 }));
    const p = await call(positioning, "calls", { level: "positioning", entityId: "btc" });
    expect(positioning).toHaveBeenCalledWith("/v3/calls/positioning", { entityId: "btc" });
    expect(p.structuredContent).toMatchObject({ items: [{ openLong: 3 }], hasMore: false });
  });

  it("top_accounts reads /v3/people/accounts", async () => {
    const get = vi.fn(list("accounts"));
    const r = await call(get, "top_accounts", { limit: 3 });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(get).toHaveBeenCalledWith("/v3/people/accounts", {
      metric: undefined,
      order: undefined,
      limit: 3,
      cursor: undefined,
    });

    const byTrack = vi.fn(list("accounts"));
    await call(byTrack, "top_accounts", { metric: "alphaScore", limit: 2 });
    expect(byTrack).toHaveBeenCalledWith("/v3/people/accounts", {
      metric: "alphaScore",
      order: undefined,
      limit: 2,
      cursor: undefined,
    });

    const bogus = vi.fn(list("accounts"));
    expect((await call(bogus, "top_accounts", { metric: "followers" })).isError).toBe(true);
    expect(bogus).not.toHaveBeenCalled();
    expect(r.structuredContent?.notice).toMatch(/third-party/i);
  });

  it("locks every v3 tool for a key without v3 scopes, and never calls the API", async () => {
    const get = vi.fn(list("items"));
    for (const [name, args] of [
      ["entities", { q: "btc" }],
      ["events", { from: 1 }],
      ["market", {}],
      ["calls", { from: 1 }],
      ["top_accounts", {}],
    ] as const) {
      const r = await call(get, name, args, ["key-status", "data/top-mentions"]);
      expect(r.isError, name).toBe(true);
      expect(JSON.stringify(r.content)).toContain("requires a higher-tier plan");
    }
    expect(get).not.toHaveBeenCalled();
  });

  it("unlocks a v3 tool for an exact scope or a family grant the API accepts", async () => {
    const get = vi.fn(list("items"));
    for (const [name, args, scopes] of [
      ["entities", { q: "btc" }, ["entities"]],
      ["entities", { q: "btc" }, ["entities/*"]],
      ["events", { from: 1 }, ["events/*"]],
      ["events", { from: 1 }, ["events/storylines"]],
      ["market", {}, ["market/equity/mindshare"]],
      ["calls", { from: 1 }, ["calls/*"]],
      ["top_accounts", {}, ["people/accounts"]],
    ] as const) {
      const r = await call(get, name, args, ["key-status", ...scopes]);
      expect(r.isError, `${name} ${scopes.join(",")} ${JSON.stringify(r.content)}`).toBeFalsy();
    }
  });
});

describe("api_status historyFrom", () => {
  it("is null when /v3/key-status fails, and the v2 status still reports", async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe", version: "1.0.0" });
    const server = createServer({
      sdk: {
        ping: async () => ({ success: true }),
        getApiKeyStatus: async () => ({ success: true, data: { tier: "grow" } }),
      } as unknown as Deps["sdk"],
      v3: { get: async () => Promise.reject(new V3ApiError("down", 503)) },
      maxResponseChars: 60000,
    });
    await Promise.all([client.connect(ct), server.connect(st)]);
    const result = await client.callTool({ name: "api_status", arguments: {} });
    await server.close();
    expect(result.structuredContent).toMatchObject({ historyFrom: null, key: { tier: "grow" } });
    expect((result.structuredContent as { problem: string }).problem).toMatch(/^historyFrom unavailable/);
  });

  it("does not wait more than 3 seconds for /v3/key-status", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const get = vi.fn(() => new Promise<Record<string, unknown>>(() => {}));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "probe", version: "1.0.0" });
    const server = createServer({
      sdk: {
        ping: async () => ({ success: true }),
        getApiKeyStatus: async () => ({ success: true, data: { tier: "grow" } }),
      } as unknown as Deps["sdk"],
      v3: { get },
      maxResponseChars: 60000,
    });
    await Promise.all([client.connect(ct), server.connect(st)]);
    const pending = client.callTool({ name: "api_status", arguments: {} });
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;
    await server.close();
    vi.useRealTimers();
    expect(result.structuredContent).toMatchObject({ historyFrom: null, key: { tier: "grow" } });
    expect(get).toHaveBeenCalledWith("/v3/key-status", {}, { timeout: 3_000, retries: 0 });
  });
});

describe("trimmed pages", () => {
  const big = "x".repeat(400);

  it("tells the agent to re-read the page only when page items were dropped", () => {
    const page = { items: Array.from({ length: 30 }, () => ({ big })), nextCursor: "c" };
    expect(JSON.stringify(toResult(page, 2_000).content)).toContain("nextCursor continues after the omitted items");
  });

  it("leaves the cursor advice out when only nested lists were trimmed", () => {
    const page = { items: [{ sources: Array.from({ length: 30 }, () => big) }], nextCursor: "c" };
    const text = JSON.stringify(toResult(page, 2_000).content);
    expect(text).toContain("omitted");
    expect(text).not.toContain("nextCursor continues");
  });
});
