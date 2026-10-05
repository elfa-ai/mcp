import { describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import type { Deps } from "../src/client.js";
import { readSources } from "../src/tools/chat.js";

async function callChat(chat: (params: unknown) => Promise<unknown>) {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "probe", version: "1.0.0" });
  const server = createServer({ sdk: { chat } as unknown as Deps["sdk"], maxResponseChars: 60000 });
  await Promise.all([client.connect(ct), server.connect(st)]);
  const result = await client.callTool({
    name: "market_chat",
    arguments: { message: "what is X saying about SOL ETFs?" },
  });
  await server.close();
  return result;
}

describe("market_chat sources", () => {
  it("asks the API for sources and returns them", async () => {
    const chat = vi.fn(async () => ({
      success: true,
      data: {
        message: "answer",
        sessionId: "s1",
        creditsConsumed: 5,
        sources: [
          { url: "https://x.com/a/status/1", kind: "x_post", title: "Searched X" },
          { url: "https://example.com/story", kind: "storyline" },
        ],
      },
    }));

    const result = await callChat(chat);

    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ includeSources: true }));
    expect(result.structuredContent).toMatchObject({
      message: "answer",
      sources: [
        { url: "https://x.com/a/status/1", kind: "x_post", title: "Searched X" },
        { url: "https://example.com/story", kind: "storyline" },
      ],
    });
  });

  it("returns an empty list when the API sends no sources", async () => {
    const chat = vi.fn(async () => ({
      success: true,
      data: { message: "answer", sessionId: "s1", creditsConsumed: 5 },
    }));

    const result = await callChat(chat);

    expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ sources: [] });
  });
});

describe("readSources", () => {
  it("keeps well-formed entries and drops the rest", () => {
    expect(
      readSources([
        { url: "https://x.com/a/status/1", kind: "x_post", title: "Searched X" },
        { url: "https://t.me/c/2", kind: "telegram", title: 7 },
        { url: "https://no-kind.example" },
        { kind: "web" },
        null,
        "https://bare.example",
      ]),
    ).toEqual([
      { url: "https://x.com/a/status/1", kind: "x_post", title: "Searched X" },
      { url: "https://t.me/c/2", kind: "telegram" },
    ]);
  });

  it("returns [] for a non-array", () => {
    expect(readSources(undefined)).toEqual([]);
    expect(readSources({ url: "x" })).toEqual([]);
  });
});
