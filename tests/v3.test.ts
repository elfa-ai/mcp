import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { Deps } from "../src/client.js";
import { describeError } from "../src/errors.js";
import { toResult } from "../src/shape.js";
import { createV3Client, queryString, V3ApiError, V3RedirectError, type V3Params } from "../src/v3.js";

type Get = (path: string, params?: V3Params) => Promise<Record<string, unknown>>;
type Send = Deps["v3"]["send"];

async function call(
  get: Get,
  name: string,
  args: Record<string, unknown>,
  scopes?: string[],
  send: Send = async () => ({}),
) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "probe", version: "1.0.0" });
  const server = createServer(
    { sdk: {} as Deps["sdk"], v3: { get, send }, maxResponseChars: 60000 },
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

  it("sends an access token as a bearer and no key header", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createV3Client({ accessToken: "elfa_api_x", timeout: 1000, retries: 0 });
    await client.get("/v3/entities");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: "Bearer elfa_api_x" });
    expect(init.headers).not.toHaveProperty("x-elfa-api-key");
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
          headers: { "RateLimit-Reset": "42" },
        }),
      ),
    );
    const spent = await client.get("/v3/events").catch((e: unknown) => e);
    expect(describeError(spent)).toContain("retrying will not help");
    expect(describeError(spent)).not.toContain("Resets in");

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

  it("sends a write once with a JSON body, whatever the retry setting", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "m1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createV3Client({ apiKey: "k", baseUrl: "https://api.example", timeout: 1000, retries: 2 });

    await expect(client.send("POST", "/v3/monitors", { query: "q" })).resolves.toEqual({ id: "m1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example/v3/monitors");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ query: "q" }));
    expect(init.headers).toMatchObject({ "x-elfa-api-key": "k", "Content-Type": "application/json" });
    expect(init.redirect).toBe("error");

    const down = vi.fn(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", down);
    await expect(client.send("PATCH", "/v3/monitors/m1", { query: "q" })).rejects.toBeInstanceOf(V3ApiError);
    expect(down).toHaveBeenCalledTimes(1);

    const removed = vi.fn(async () => new Response(JSON.stringify({ id: "m1", deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", removed);
    await client.send("DELETE", "/v3/monitors/m1");
    const [, deleteInit] = removed.mock.calls[0] as unknown as [string, RequestInit];
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteInit.body).toBeUndefined();
    expect(deleteInit.headers).not.toHaveProperty("Content-Type");
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

  it("events sends eventCategory and refuses an unknown or empty one", async () => {
    const get = vi.fn(list("events"));
    const r = await call(get, "events", { from: 1, eventType: "macro", eventCategory: ["economy", "forecast"] });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    const [, params] = get.mock.calls[0] as unknown as [string, V3Params];
    expect(params.eventCategory).toEqual(["economy", "forecast"]);
    expect(params.eventType).toBe("macro");

    const refused = vi.fn(list("events"));
    expect((await call(refused, "events", { from: 1, eventCategory: ["rumour"] })).isError).toBe(true);
    expect((await call(refused, "events", { from: 1, eventCategory: [] })).isError).toBe(true);
    expect(refused).not.toHaveBeenCalled();
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

  it("calendar reads /v3/events/calendar with its list filters", async () => {
    const get = vi.fn(list("entries"));
    const r = await call(get, "calendar", {
      category: ["unlock", "macro"],
      status: ["scheduled", "occurred"],
      minImportance: 80,
    });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(get).toHaveBeenCalledWith("/v3/events/calendar", {
      from: undefined,
      to: undefined,
      entityIds: undefined,
      assetClass: undefined,
      category: ["unlock", "macro"],
      status: ["scheduled", "occurred"],
      confidence: undefined,
      minImportance: 80,
      order: undefined,
      limit: 10,
      cursor: undefined,
    });
    expect(r.structuredContent).toMatchObject({ items: [{ id: "a" }], nextCursor: "next", hasMore: true, servedFrom: 1790672305 });
    expect(r.structuredContent?.notice).toMatch(/third-party/i);

    const bogus = vi.fn(list("entries"));
    expect((await call(bogus, "calendar", { status: ["open"] })).isError).toBe(true);
    expect((await call(bogus, "calendar", { minImportance: 101 })).isError).toBe(true);
    expect(bogus).not.toHaveBeenCalled();
  });

  it("prediction_markets reads /v3/events/prediction-markets for the ids held", async () => {
    const related = [{ id: "s1", kind: "storyline", markets: [{ provider: "kalshi", marketId: "M" }] }];
    const get = vi.fn(async () => ({ related }));
    const r = await call(get, "prediction_markets", { ids: ["s1", "e1"] });
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(get).toHaveBeenCalledWith("/v3/events/prediction-markets", { ids: ["s1", "e1"], limit: 10 });
    expect(r.structuredContent).toMatchObject({ related });
    expect(r.structuredContent?.notice).toMatch(/third-party/i);

    const none = vi.fn(async () => ({ related: [] }));
    expect((await call(none, "prediction_markets", { ids: [] })).isError).toBe(true);
    expect(none).not.toHaveBeenCalled();
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

  it("verify posts the claim to /v3/verify and returns the verdict", async () => {
    const verdict = {
      verdict: "supported",
      probabilities: { supported: 0.9, contradicted: 0.02, notEnoughEvidence: 0.08 },
      decision: { type: "yesNo", yes: 0.88 },
      evidence: { twitter: [{ link: "https://x.com/a/status/1", decisiveness: 0.9, basis: true }], telegram: [], web: [] },
      asOf: 1794830400,
      searchedFrom: 1794225600,
      coverage: { complete: true, sources: { twitter: "complete", telegram: "complete", web: "complete" }, captions: "complete" },
    };
    const send = vi.fn(async () => verdict);
    const get = vi.fn();
    const r = await call(
      get,
      "verify",
      { statement: "Binance will list HYPE.", decision: { type: "yesNo", yes: "A date is announced." } },
      undefined,
      send,
    );
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(send).toHaveBeenCalledWith("POST", "/v3/verify", {
      statement: "Binance will list HYPE.",
      decision: { type: "yesNo", yes: "A date is announced." },
    });
    expect(r.structuredContent).toMatchObject({ verdict: "supported", decision: { yes: 0.88 } });
    expect(get).not.toHaveBeenCalled();
  });

  it("verify refuses what the API would refuse, without a call", async () => {
    const send = vi.fn(async () => ({}));
    for (const args of [
      { statement: "x".repeat(501) },
      { statement: "a", context: "x".repeat(4001) },
      { statement: "a", decision: { type: "choice", options: [{ label: "only", definition: "one" }] } },
      { statement: "a", decision: { type: "score", levels: Array.from({ length: 11 }, (_, i) => `l${i}`) } },
      { statement: "a", decision: { type: "maybe" } },
      { statement: "a", decision: { type: "yesNo", yess: "typo" } },
      { statement: "a", decision: { type: "choice", options: [{ label: "a", definition: "x", extra: 1 }, { label: "b", definition: "y" }] } },
    ]) {
      expect((await call(vi.fn(), "verify", args, undefined, send)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("monitors lists, reads one and pages a monitor's matches", async () => {
    const id = "5b0c6f8e-2f7a-4f43-9a8e-3c1d2a9b7e10";
    const monitor = { id, query: "q", webhookUrl: "https://example.com/hook", webhookSecret: "whsec_test", status: "active" };

    const listed = vi.fn(async () => ({ data: [monitor], total: 1 }));
    const l = await call(listed, "monitors", { method: "list" });
    expect(l.isError, JSON.stringify(l.content)).toBeFalsy();
    expect(listed).toHaveBeenCalledWith("/v3/monitors");
    expect(l.structuredContent).toMatchObject({ method: "list", items: [{ id, webhookSecret: "whsec_test" }], nextCursor: null });

    const one = vi.fn(async () => monitor);
    const g = await call(one, "monitors", { method: "get", id });
    expect(one).toHaveBeenCalledWith(`/v3/monitors/${id}`);
    expect(g.structuredContent).toMatchObject({ items: [{ id, status: "active" }] });

    const matches = vi.fn(async () => ({ data: [{ id: "msg_1", monitorId: id, items: [] }], nextCursor: "older" }));
    const m = await call(matches, "monitors", { method: "matches", id, limit: 50, cursor: "c1" });
    expect(matches).toHaveBeenCalledWith(`/v3/monitors/${id}/events`, { limit: 50, cursor: "c1" });
    expect(m.structuredContent).toMatchObject({ method: "matches", items: [{ id: "msg_1" }], nextCursor: "older" });
    expect(m.structuredContent?.notice).toMatch(/third-party/i);

    const none = vi.fn();
    expect((await call(none, "monitors", { method: "matches" })).isError).toBe(true);
    expect((await call(none, "monitors", { method: "get", id: "not-a-uuid" })).isError).toBe(true);
    expect((await call(none, "monitors", { method: "matches", id, limit: 101 })).isError).toBe(true);
    expect(none).not.toHaveBeenCalled();
  });

  it("monitors_write creates, updates and deletes, and returns the webhook secret on create", async () => {
    const id = "5b0c6f8e-2f7a-4f43-9a8e-3c1d2a9b7e10";
    const created = { id, query: "q q", webhookUrl: "https://example.com/hook", webhookSecret: "whsec_test", status: "active" };
    const send = vi.fn(async () => created);
    const c = await call(
      vi.fn(),
      "monitors_write",
      { method: "create", query: "q q", webhookUrl: "https://example.com/hook" },
      undefined,
      send,
    );
    expect(c.isError, JSON.stringify(c.content)).toBeFalsy();
    expect(send).toHaveBeenCalledWith("POST", "/v3/monitors", { query: "q q", webhookUrl: "https://example.com/hook" });
    expect(c.structuredContent).toMatchObject({ method: "create", data: { webhookSecret: "whsec_test" } });
    expect(JSON.stringify(c.content)).toContain("whsec_test");

    const update = vi.fn(async () => created);
    await call(vi.fn(), "monitors_write", { method: "update", id, query: "new query" }, undefined, update);
    expect(update).toHaveBeenCalledWith("PATCH", `/v3/monitors/${id}`, { query: "new query" });

    const remove = vi.fn(async () => ({ id, deleted: true }));
    const d = await call(vi.fn(), "monitors_write", { method: "delete", id }, undefined, remove);
    expect(remove).toHaveBeenCalledWith("DELETE", `/v3/monitors/${id}`);
    expect(d.structuredContent).toMatchObject({ data: { deleted: true } });
  });

  it("monitors_write says to read the monitors before retrying an unsure create or update", async () => {
    const id = "5b0c6f8e-2f7a-4f43-9a8e-3c1d2a9b7e10";
    for (const [method, args] of [
      ["create", { query: "q q", webhookUrl: "https://example.com/hook" }],
      ["update", { id, query: "new query" }],
    ] as const) {
      for (const failure of [new V3ApiError("Service unavailable", 503), new Error("The Elfa API did not answer within 1000 ms, so the request may still have been applied.")]) {
        const send = vi.fn(async () => Promise.reject(failure));
        const r = await call(vi.fn(), "monitors_write", { method, ...args }, undefined, send);
        expect(r.isError).toBe(true);
        expect(JSON.stringify(r.content)).toContain("read the monitors with the monitors tool before retrying");
        expect(JSON.stringify(r.content)).not.toContain("retry shortly");
      }
    }

    const rejected = vi.fn(async () => Promise.reject(new V3ApiError("Invalid body", 400)));
    const r = await call(vi.fn(), "monitors_write", { method: "create", query: "q q", webhookUrl: "https://example.com/hook" }, undefined, rejected);
    expect(JSON.stringify(r.content)).toContain("Request rejected as invalid");
    expect(JSON.stringify(r.content)).not.toContain("read the monitors");
  });

  it("monitors_write refuses what the API would refuse, without a call", async () => {
    const id = "5b0c6f8e-2f7a-4f43-9a8e-3c1d2a9b7e10";
    const send = vi.fn(async () => ({}));
    for (const args of [
      { method: "create", query: "q q" },
      { method: "create", webhookUrl: "https://example.com/hook" },
      { method: "create", query: "q q", webhookUrl: "http://example.com/hook" },
      { method: "create", query: "qq", webhookUrl: "https://example.com/hook" },
      { method: "create", query: "x".repeat(501), webhookUrl: "https://example.com/hook" },
      { method: "update", query: "new query" },
      { method: "update", id },
      { method: "delete" },
    ]) {
      expect((await call(vi.fn(), "monitors_write", args, undefined, send)).isError, JSON.stringify(args)).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves the monitors tools unlocked on a key without their scope, and the API decides", async () => {
    const get = vi.fn(async () => ({ data: [], total: 0 }));
    const r = await call(get, "monitors", { method: "list" }, ["key-status", "data/top-mentions"]);
    expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
    expect(get).toHaveBeenCalledTimes(1);

    const send = vi.fn(async () => ({ id: "m1", deleted: true }));
    const w = await call(
      vi.fn(),
      "monitors_write",
      { method: "delete", id: "5b0c6f8e-2f7a-4f43-9a8e-3c1d2a9b7e10" },
      ["key-status", "data/top-mentions"],
      send,
    );
    expect(w.isError, JSON.stringify(w.content)).toBeFalsy();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("locks every v3 tool for a key without v3 scopes, and never calls the API", async () => {
    const get = vi.fn(list("items"));
    const send = vi.fn(async () => ({}));
    for (const [name, args] of [
      ["entities", { q: "btc" }],
      ["events", { from: 1 }],
      ["calendar", {}],
      ["prediction_markets", { ids: ["e1"] }],
      ["market", {}],
      ["calls", { from: 1 }],
      ["top_accounts", {}],
      ["verify", { statement: "a" }],
    ] as const) {
      const r = await call(get, name, args, ["key-status", "data/top-mentions"], send);
      expect(r.isError, name).toBe(true);
      expect(JSON.stringify(r.content)).toContain("requires a higher-tier plan");
    }
    expect(get).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("unlocks a v3 tool for an exact scope or a family grant the API accepts", async () => {
    const get = vi.fn(list("items"));
    const send = vi.fn(async () => ({
      verdict: "notEnoughEvidence",
      probabilities: { supported: 0, contradicted: 0, notEnoughEvidence: 1 },
      decision: null,
      evidence: { twitter: [], telegram: [], web: [] },
      asOf: 1,
      searchedFrom: 1,
      coverage: { complete: true },
    }));
    for (const [name, args, scopes] of [
      ["entities", { q: "btc" }, ["entities"]],
      ["entities", { q: "btc" }, ["entities/*"]],
      ["events", { from: 1 }, ["events/*"]],
      ["events", { from: 1 }, ["events/storylines"]],
      ["calendar", {}, ["events/calendar"]],
      ["calendar", {}, ["events/*"]],
      ["prediction_markets", { ids: ["e1"] }, ["events/prediction-markets"]],
      ["market", {}, ["market/equity/mindshare"]],
      ["calls", { from: 1 }, ["calls/*"]],
      ["top_accounts", {}, ["people/accounts"]],
      ["verify", { statement: "a" }, ["verify"]],
    ] as const) {
      const r = await call(get, name, args, ["key-status", ...scopes], send);
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
      v3: { get: async () => Promise.reject(new V3ApiError("down", 503)), send: async () => ({}) },
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
      v3: { get, send: async () => ({}) },
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
