import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { describeError, missingCredential } from "../src/errors.js";
import { shapeMention, toResult } from "../src/shape.js";
import { pickDefined, requiresSignature, stripHandle } from "../src/tools/util.js";

describe("config", () => {
  it("defaults to stdio", () => {
    expect(loadConfig({}).transport).toBe("stdio");
  });

  it("switches to http only on an exact match", () => {
    expect(loadConfig({ ELFA_MCP_TRANSPORT: "http" }).transport).toBe("http");
    expect(loadConfig({ ELFA_MCP_TRANSPORT: "HTTP" }).transport).toBe("stdio");
  });

  it("ignores non-positive numeric overrides", () => {
    expect(loadConfig({ ELFA_MCP_PORT: "0" }).port).toBe(3000);
    expect(loadConfig({ ELFA_MCP_PORT: "8080" }).port).toBe(8080);
  });

  it("splits the origin allowlist", () => {
    expect(
      loadConfig({ ELFA_MCP_ALLOWED_ORIGINS: "https://a.example, https://b.example" })
        .allowedOrigins,
    ).toEqual(["https://a.example", "https://b.example"]);
  });
});

describe("errors", () => {
  it("turns status codes into instructions", () => {
    expect(describeError({ statusCode: 429, message: "slow down" })).toContain(
      "retry with fewer",
    );
    expect(describeError({ statusCode: 410, message: "stream closed" })).toContain(
      "No longer available",
    );
    expect(describeError({ statusCode: 402, message: "no credits" })).toContain(
      "Top up",
    );
    expect(describeError({ statusCode: 503, message: "down" })).toContain(
      "server side",
    );
  });

  it("falls back to the raw message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("names the variable that is missing", () => {
    expect(missingCredential("apiKey")).toContain("ELFA_API_KEY");
    expect(missingCredential("hmacSecret")).toContain("ELFA_HMAC_SECRET");
  });
});

describe("shape", () => {
  const mention = {
    tweetId: "1",
    link: "https://x.com/a/status/1",
    mentionedAt: "2026-01-01T00:00:00Z",
    viewCount: 10,
    likeCount: 2,
    repostCount: 1,
    replyCount: 3,
    account: { username: "someone", isVerified: true },
  };

  it("keeps concise output small", () => {
    expect(Object.keys(shapeMention(mention, "concise"))).toEqual([
      "at",
      "by",
      "link",
      "views",
      "likes",
      "reposts",
    ]);
  });

  it("adds the rest under detailed", () => {
    expect(shapeMention(mention, "detailed")).toMatchObject({
      replies: 3,
      verified: true,
    });
  });

  it("trims oversized payloads, says so, and keeps both views in step", () => {
    const items = Array.from({ length: 500 }, (_, index) => ({
      index,
      filler: "x".repeat(100),
    }));

    const result = toResult({ items }, 2000);
    const text = result.content[0] as { text: string };
    const structured = result.structuredContent as { items: unknown[] };

    expect(text.text).toContain("omitted");
    expect(structured.items.length).toBeLessThan(items.length);

    const serialised = text.text.slice(0, text.text.lastIndexOf("}") + 1);
    expect(JSON.parse(serialised)).toEqual(structured);
  });

  it("leaves payloads under the ceiling untouched", () => {
    const payload = { items: [{ a: 1 }, { a: 2 }] };
    const result = toResult(payload, 60000);

    expect(result.structuredContent).toEqual(payload);
    expect((result.content[0] as { text: string }).text).not.toContain("omitted");
  });
});

describe("util", () => {
  it("lets notification-only queries through unsigned", () => {
    for (const type of ["notify", "telegram_bot", "webhook"]) {
      expect(requiresSignature({ actions: [{ stepId: "s", type, params: {} }] }), type).toBe(
        false,
      );
    }
  });

  it("requires a signature for order actions", () => {
    for (const type of ["market_order", "limit_order"]) {
      expect(requiresSignature({ actions: [{ stepId: "s", type, params: {} }] }), type).toBe(
        true,
      );
    }
  });

  it("whitelists rather than blacklists", () => {
    expect(requiresSignature({ actions: [{ stepId: "s", params: {} }] })).toBe(true);
    expect(requiresSignature({ actions: [{ stepId: "s", type: "future_type" }] })).toBe(true);
    expect(requiresSignature({ actions: [] })).toBe(true);
    expect(requiresSignature({})).toBe(true);
    expect(requiresSignature(null)).toBe(true);
  });

  it("allows an llm action only when its callback is a notification", () => {
    expect(
      requiresSignature({
        actions: [
          {
            stepId: "s",
            type: "llm",
            params: { callback: { action: { type: "notify" } } },
          },
        ],
      }),
    ).toBe(false);

    expect(
      requiresSignature({
        actions: [
          {
            stepId: "s",
            type: "llm",
            params: { callback: { action: { type: "market_order" } } },
          },
        ],
      }),
    ).toBe(true);

    expect(
      requiresSignature({ actions: [{ stepId: "s", type: "llm", params: {} }] }),
    ).toBe(true);
  });

  it("requires a signature when any single action is not a notification", () => {
    expect(
      requiresSignature({
        actions: [
          { stepId: "a", type: "notify", params: {} },
          { stepId: "b", type: "market_order", params: {} },
        ],
      }),
    ).toBe(true);
  });

  it("drops undefined values", () => {
    expect(pickDefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
  });

  it("normalises handles", () => {
    expect(stripHandle("@elfa_ai")).toBe("elfa_ai");
    expect(stripHandle("elfa_ai")).toBe("elfa_ai");
  });
});

describe("mentions without an author", () => {
  it("omits by rather than reporting a null author", () => {
    const shaped = shapeMention(
      { link: "https://x.com/i/status/1", mentionedAt: "2026-01-01T00:00:00Z", viewCount: 1 },
      "concise",
    );

    expect("by" in shaped).toBe(false);
    expect(shaped.link).toBeTruthy();
  });

  it("keeps by when the endpoint returns an account", () => {
    const shaped = shapeMention(
      { mentionedAt: "2026-01-01T00:00:00Z", account: { username: "someone", isVerified: true } },
      "detailed",
    );

    expect(shaped.by).toBe("someone");
    expect(shaped.verified).toBe(true);
  });
});

describe("extra headers", () => {
  it("parses a JSON object of headers", () => {
    expect(loadConfig({ ELFA_EXTRA_HEADERS: '{"X-Trace":"abc"}' }).extraHeaders).toEqual({
      "X-Trace": "abc",
    });
  });

  it("refuses to let a caller override authentication headers", () => {
    expect(
      loadConfig({
        ELFA_EXTRA_HEADERS: '{"x-elfa-api-key":"stolen","X-Elfa-Signature":"forged","X-Ok":"1"}',
      }).extraHeaders,
    ).toEqual({ "X-Ok": "1" });
  });

  it("ignores malformed or non-object values", () => {
    for (const value of ["not json", "[1,2]", '"a string"', "{}", '{"a":1}']) {
      expect(loadConfig({ ELFA_EXTRA_HEADERS: value }).extraHeaders, value).toBeUndefined();
    }
  });
});
