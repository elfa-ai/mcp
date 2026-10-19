import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { UNTRUSTED_NOTICE } from "../shape.js";
import {
  cursorArg,
  entityIdsArg,
  fail,
  idsArg,
  limitArg,
  orderArg,
  page,
  pageOutput,
  run,
  stripHandle,
  v3FromArg,
  v3ToArg,
} from "./util.js";

export function registerCalls(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "calls",
    {
      title: "Calls",
      description:
        "What accounts are doing: positions taken in posts on X and Telegram.. level=calls: each post that opened, added to, trimmed, reaffirmed, reversed, closed or stopped out of a position. level=episodes: each position from open to close, with entry and exit prices and the author's track record. level=positioning: open longs and shorts on one asset right now. level=episodes with status=open and from set to now reads what every matching account holds right now. Not returned: post text or a recommendation.",
      inputSchema: {
        level: z
          .enum(["calls", "episodes", "positioning"])
          .default("calls")
          .describe("Which level to read."),
        entityId: z
          .string()
          .optional()
          .describe("level=positioning, required. One token or equity id from the entities tool."),
        from: v3FromArg.describe(
          "level=calls or episodes. Start of the range, unix seconds, not milliseconds. Required unless you fetch by ids. Episodes match a position open at any point in the range.",
        ),
        to: v3ToArg,
        ids: idsArg.describe("level=calls or episodes. Fetch up to 30 call or episode ids you already hold. No from needed."),
        handle: z
          .string()
          .optional()
          .describe("An X account, with or without @. Telegram channels cannot be filtered on."),
        entityIds: entityIdsArg.describe("Up to 30 token or equity ids from the entities tool. Matches any of them."),
        status: z
          .enum(["open", "closed"])
          .optional()
          .describe("level=episodes."),
        direction: z
          .enum(["long", "short"])
          .optional()
          .describe("level=episodes."),
        assetClass: z
          .enum(["crypto", "equity"])
          .optional()
          .describe("level=episodes. The market of the position's asset."),
        order: orderArg,
        limit: limitArg(30),
        cursor: cursorArg,
      },
      outputSchema: {
        level: z.string(),
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
      if (args.level === "positioning") {
        const entityId = args.entityId;
        if (!entityId) {
          return fail(
            "level=positioning needs entityId, one token or equity id from the entities tool. Retry with entityId set.",
          );
        }

        return run(deps, async () => {
          const response = await deps.v3.get("/v3/calls/positioning", { entityId });
          return {
            level: args.level,
            notice: UNTRUSTED_NOTICE,
            items: [response],
            nextCursor: null,
            hasMore: false,
            servedFrom: null,
          };
        });
      }

      const episodes = args.level === "episodes";

      return run(deps, async () => {
        const response = await deps.v3.get(episodes ? "/v3/calls/episodes" : "/v3/calls", {
          from: args.from,
          to: args.to,
          [episodes ? "episodeIds" : "callIds"]: args.ids,
          handle: args.handle ? stripHandle(args.handle) : undefined,
          entityIds: args.entityIds,
          status: args.status,
          direction: args.direction,
          assetClass: args.assetClass,
          order: args.order,
          limit: args.ids ? undefined : args.limit,
          cursor: args.cursor,
        });
        return {
          level: args.level,
          notice: UNTRUSTED_NOTICE,
          ...page(response, episodes ? "episodes" : "calls"),
        };
      });
    },
  );
}
