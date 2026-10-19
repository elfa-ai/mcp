import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { UNTRUSTED_NOTICE } from "../shape.js";
import {
  cursorArg,
  fail,
  limitArg,
  orderArg,
  page,
  pageOutput,
  run,
  v3FromArg,
  v3ToArg,
} from "./util.js";

const VIEWS = {
  call_book: { segment: "call-book", key: "bars" },
  mindshare: { segment: "mindshare", key: "assets" },
  trending_contracts: { segment: "trending-contracts", key: "contracts" },
} as const;

export function registerMarket(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "market",
    {
      title: "Market",
      description:
        "Whole-market views, no asset needed.. view=mindshare ranks assets by share of attention over a period, with hot on those heating up. view=call_book is the crowd's long/short lean, one bar per hour plus a live tick: read crowdingPercentile rather than longShare, since the accounts lean long almost always. view=trending_contracts ranks contract addresses by how many posts pasted them, crypto only, and the unnamed ones are often the ones worth watching.",
      inputSchema: {
        view: z
          .enum(["mindshare", "call_book", "trending_contracts"])
          .default("mindshare")
          .describe("Which view to read."),
        market: z
          .enum(["crypto", "equity"])
          .default("crypto")
          .describe("crypto or equity. trending_contracts is crypto only."),
        period: z
          .enum(["1h", "4h", "24h", "7d"])
          .optional()
          .describe("view=mindshare. The stretch share covers, ending at to. Default 4h."),
        from: v3FromArg.describe(
          "view=call_book and view=trending_contracts, required. Start of the range, unix seconds, not milliseconds. Trending contracts read 30 days at most.",
        ),
        to: v3ToArg,
        minMentions: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("view=trending_contracts. Leave out addresses pasted fewer times. Default 5."),
        order: orderArg.describe("view=call_book. desc (default) or asc."),
        limit: limitArg(200),
        cursor: cursorArg,
      },
      outputSchema: {
        view: z.string(),
        market: z.string(),
        notice: z.string(),
        ...pageOutput,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      if (args.view === "trending_contracts" && args.market !== "crypto") {
        return fail("view=trending_contracts covers crypto only. Retry with market=crypto.");
      }

      if (args.view !== "mindshare" && args.from === undefined) {
        return fail(`view=${args.view} needs from, unix seconds. Retry with from set.`);
      }

      const view = VIEWS[args.view];

      return run(deps, async () => {
        const response = await deps.v3.get(`/v3/market/${args.market}/${view.segment}`, {
          period: args.period,
          from: args.from,
          to: args.to,
          minMentions: args.minMentions,
          order: args.order,
          limit: args.limit,
          cursor: args.cursor,
        });
        return {
          view: args.view,
          market: args.market,
          notice: UNTRUSTED_NOTICE,
          ...page(response, view.key),
        };
      });
    },
  );
}
