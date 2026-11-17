import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { UNTRUSTED_NOTICE, asArray } from "../shape.js";
import { run } from "./util.js";

export function registerPredictionMarkets(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "prediction_markets",
    {
      title: "Prediction markets",
      description:
        "The open Polymarket and Kalshi markets that events, storylines or arcs bear on, and how their odds moved around the story. Send up to 30 ids of any of the three kinds, mixed if you like; each comes back with kind and its markets, most relevant first. Each market has provider and marketId, title, url, closesAt (null when it can trade past its set date) and the eventIds that point at it. move is one outcome's odds an hour before and an hour after a story's first post, and whether that was unusual for the market; it is null when no move was measured. Most events have no market, about one in eight do. Not returned: current odds, volume or a market's full list of outcomes; read those from the provider.",
      inputSchema: {
        ids: z
          .array(z.string())
          .min(1)
          .max(30)
          .describe("Up to 30 event, storyline or arc ids, any mix. An id that is not held is skipped."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe("Markets per id, up to 30."),
      },
      outputSchema: {
        notice: z.string(),
        related: z.array(z.record(z.unknown())),
      },
      annotations: {
        title: "Prediction markets",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      run(deps, async () => {
        const response = await deps.v3.get("/v3/events/prediction-markets", {
          ids: args.ids,
          limit: args.limit,
        });
        return {
          notice: UNTRUSTED_NOTICE,
          related: asArray<Record<string, unknown>>(response.related),
        };
      }),
  );
}
