import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { UNTRUSTED_NOTICE } from "../shape.js";
import { cursorArg, limitArg, orderArg, page, run } from "./util.js";

export function registerTopAccounts(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "top_accounts",
    {
      title: "Top accounts",
      description:
        "X accounts ranked by standing (how much other accounts engage with them) or, with metric, by their track record as callers.. Standing measures attention, not accuracy; track is null for an account that has never opened a position. For the best callers use metric=alphaScore, not avgReturn, which a few big wins or a rally can top. Track metrics rank only accounts with at least 20 scored positions, over every position since late June 2026; quote the number you ranked by with scoredEpisodes. Pass a handle to the calls tool to see its positions.",
      inputSchema: {
        metric: z
          .enum(["standing", "alphaScore", "hitRate", "avgReturn"])
          .optional()
          .describe(
            "standing (default). alphaScore: return against the market (BTC for crypto, SPY for equities) and outright. hitRate: share of scored positions that made money. avgReturn: mean realized return, not adjusted for the market.",
          ),
        order: orderArg.describe("desc (default) ranks the highest first."),
        limit: limitArg(200),
        cursor: cursorArg,
      },
      outputSchema: {
        notice: z.string(),
        items: z.array(z.record(z.unknown())),
        nextCursor: z.string().nullable(),
        hasMore: z.boolean(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      run(deps, async () => {
        const response = await deps.v3.get("/v3/people/accounts", {
          metric: args.metric,
          order: args.order,
          limit: args.limit,
          cursor: args.cursor,
        });
        const { items, nextCursor, hasMore } = page(response, "accounts");
        return { notice: UNTRUSTED_NOTICE, items, nextCursor, hasMore };
      }),
  );
}
