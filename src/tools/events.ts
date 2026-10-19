import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { UNTRUSTED_NOTICE } from "../shape.js";
import {
  cursorArg,
  entityIdsArg,
  idsArg,
  limitArg,
  orderArg,
  page,
  pageOutput,
  run,
  v3FromArg,
  v3ToArg,
} from "./util.js";

const LEVELS = {
  events: { path: "/v3/events", ids: "eventIds" },
  storylines: { path: "/v3/events/storylines", ids: "storylineIds" },
  arcs: { path: "/v3/events/arcs", ids: "arcIds" },
} as const;

export function registerEvents(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "events",
    {
      title: "Events",
      description:
        "What is happening in crypto and equity markets, written up from posts across many sources.. level=events: what happened, what it names, how prices reacted where measured (impacts is empty on most events), and the posts behind it. level=storylines: the events of one development, threaded over days. level=arcs: storylines grouped into a larger movement. Search any level by topic with q, filter by asset with entityIds from the entities tool, or fetch up to 30 you hold with ids. Not returned: post text, a sentiment score or a price.",
      inputSchema: {
        level: z
          .enum(["events", "storylines", "arcs"])
          .default("events")
          .describe("Which level to read."),
        q: z
          .string()
          .min(1)
          .max(500)
          .optional()
          .describe(
            'Search by topic, best match first, for example "stablecoin regulation". from becomes optional.',
          ),
        from: v3FromArg.describe(
          "level=events or storylines. Start of the range, unix seconds, not milliseconds. Required unless you fetch by ids or search with q. Arcs take no from. api_status returns historyFrom, the earliest time your plan reads.",
        ),
        to: v3ToArg.describe("level=events or storylines. End of the range, unix seconds. Defaults to now."),
        ids: idsArg,
        entityIds: entityIdsArg,
        eventClass: z
          .enum(["market", "asset", "call"])
          .optional()
          .describe("level=events. market: a development reported across posts. asset: posts about one asset. call: accounts taking positions."),
        eventType: z
          .enum([
            "security",
            "listing",
            "regulatory",
            "macro",
            "protocol",
            "company",
            "marketFlow",
            "price",
            "social",
            "other",
          ])
          .optional()
          .describe("level=events. What kind of development it is."),
        implication: z
          .enum(["bullish", "bearish", "mixed", "unclear"])
          .optional()
          .describe("level=events. Which way it cuts for the assets it names."),
        assetClass: z
          .enum(["crypto", "equity"])
          .optional()
          .describe("level=events: events tied to this market by what they name, plus events tied to neither, such as macro news; a repeated query can return fewer as names get linked to assets. level=arcs: arcs with at least 15% of their events naming an asset in this market, then macro arcs."),
        novelty: z
          .enum(["new", "update"])
          .optional()
          .describe("level=events. update: a later reading of a story already served."),
        alertAction: z
          .array(z.enum(["alert", "monitor"]))
          .min(1)
          .optional()
          .describe("level=events. alert: judged impactful. monitor: worth watching."),
        hasStoryline: z
          .boolean()
          .optional()
          .describe("level=events. true keeps events in a storyline, false those in none."),
        notable: z
          .boolean()
          .optional()
          .describe("level=events. true drops events their storyline marked as not material."),
        arcId: z
          .string()
          .optional()
          .describe("level=events. Events in one arc's storylines."),
        relation: z
          .array(
            z.enum([
              "origin",
              "update",
              "confirmation",
              "contradiction",
              "mitigation",
              "consequence",
              "reaction",
              "context",
            ]),
          )
          .min(1)
          .optional()
          .describe("level=storylines. Storylines holding an event of this relation."),
        status: z
          .enum(["open", "dormant", "any", "active", "retired"])
          .optional()
          .describe(
            "level=storylines: open (default; every status with q), dormant or any. level=arcs: active (default) or retired.",
          ),
        sort: z
          .enum(["latest", "relevant", "storylines", "events"])
          .optional()
          .describe(
            "level=events: latest (default), or relevant, which ranks the last 24 hours and takes no from. level=arcs: latest, storylines or events.",
          ),
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
    async (args) =>
      run(deps, async () => {
        const level = LEVELS[args.level];
        const response = await deps.v3.get(level.path, {
          q: args.q,
          from: args.from,
          to: args.to,
          [level.ids]: args.ids,
          entityIds: args.entityIds,
          eventClass: args.eventClass,
          eventType: args.eventType,
          implication: args.implication,
          assetClass: args.assetClass,
          novelty: args.novelty,
          alertAction: args.alertAction,
          hasStoryline: args.hasStoryline,
          notable: args.notable,
          arcId: args.arcId,
          relation: args.relation,
          status: args.status,
          sort: args.sort,
          order: args.order,
          limit: args.ids ? undefined : args.limit,
          cursor: args.cursor,
        });
        return {
          level: args.level,
          notice: UNTRUSTED_NOTICE,
          ...page(response, args.level),
        };
      }),
  );
}
