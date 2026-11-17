import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { UNTRUSTED_NOTICE } from "../shape.js";
import { cursorArg, entityIdsArg, limitArg, orderArg, page, pageOutput, run } from "./util.js";

export function registerCalendar(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "calendar",
    {
      title: "Calendar",
      description:
        "What is scheduled across crypto, equities and macro: launches, unlocks, votes, listings, earnings, data releases, rate decisions, hearings, conferences and deadlines. Soonest first, reaching about 400 days ahead. With no range it reads ahead from 00:00 UTC today for 30 days. Each entry has startsAt, precision (exact, or day: read date, which never shifts with a time zone), status, importance (0 to 100; 80 and up, unless postponed or cancelled, is a key date, about two a day), confidence (official, reported or rumored), the entities it is about, and the eventIds and storylineIds that reported the date. Once an entry is over, outcome names the event that reported it happened.",
      inputSchema: {
        from: z
          .number()
          .int()
          .optional()
          .describe(
            "Start of the range, unix seconds, not milliseconds. Defaults to 00:00 UTC today, or 30 days before to when to is earlier. An entry still running at from is listed too.",
          ),
        to: z
          .number()
          .int()
          .optional()
          .describe("End of the range, unix seconds, inclusive. Defaults to 30 days after from."),
        entityIds: entityIdsArg,
        assetClass: z
          .enum(["crypto", "equity"])
          .optional()
          .describe("Entries about an asset in this market, plus entries about no asset, such as macro and conferences."),
        category: z
          .array(
            z.enum([
              "macro",
              "earnings",
              "unlock",
              "governance",
              "listing",
              "launch",
              "airdrop",
              "conference",
              "regulatory",
              "protocolUpgrade",
              "corporateAction",
              "marketResolution",
              "campaign",
              "expiry",
              "deadline",
              "geopolitics",
              "other",
            ]),
          )
          .min(1)
          .optional()
          .describe("Kinds of occasion to keep. Omit for every kind."),
        status: z
          .array(z.enum(["scheduled", "rescheduled", "postponed", "cancelled", "past", "occurred"]))
          .min(1)
          .optional()
          .describe(
            "Statuses to keep. Omit for every status. past: over with nothing reporting it happened. occurred: over, and outcome names the event that reported it.",
          ),
        confidence: z
          .array(z.enum(["official", "reported", "rumored"]))
          .min(1)
          .optional()
          .describe("official: from the project or issuer. reported: by others. rumored: unconfirmed."),
        minImportance: z
          .number()
          .min(0)
          .max(100)
          .optional()
          .describe("0 to 100. 80 keeps the key dates; postponed or cancelled entries keep their score, so add status to drop them."),
        order: orderArg.describe("asc (default) soonest first, or desc."),
        limit: limitArg(30),
        cursor: cursorArg,
      },
      outputSchema: {
        notice: z.string(),
        ...pageOutput,
      },
      annotations: {
        title: "Calendar",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      run(deps, async () => {
        const response = await deps.v3.get("/v3/events/calendar", {
          from: args.from,
          to: args.to,
          entityIds: args.entityIds,
          assetClass: args.assetClass,
          category: args.category,
          status: args.status,
          confidence: args.confidence,
          minImportance: args.minImportance,
          order: args.order,
          limit: args.limit,
          cursor: args.cursor,
        });
        return { notice: UNTRUSTED_NOTICE, ...page(response, "entries") };
      }),
  );
}
