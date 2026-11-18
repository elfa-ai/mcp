import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { UNTRUSTED_NOTICE, asArray } from "../shape.js";
import { fail, limitArg, run } from "./util.js";

export function registerMonitors(server: McpServer, deps: Deps): void {
  server.registerTool(
    "monitors",
    {
      title: "Read monitors",
      description:
        "Read side of Monitors. Free. method=list returns this key's newest 100 monitors, live ones and ones Elfa ended in the last 30 days, with no paging. method=get returns one monitor. Each monitor carries its query, webhookUrl, webhookSecret, status (active, or ended when Elfa stopped it, for example when the key could not pay for an hour) and createdAt and updatedAt in unix seconds. method=matches returns one monitor's matches, newest first, kept for 30 days: each match lists the Elfa events or web pages that matched, with an event's id for the events tool.",
      inputSchema: {
        method: z.enum(["list", "get", "matches"]).describe("Which read to perform."),
        id: z.string().uuid().optional().describe("The monitor id. Required for get and matches."),
        limit: limitArg(100).describe(
          "method=matches. Matches per page, up to 100. Keep it small and page with cursor rather than asking for everything at once.",
        ),
        cursor: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe("method=matches. nextCursor from the previous page of the same monitor."),
      },
      outputSchema: {
        method: z.string(),
        notice: z.string().optional(),
        items: z.array(z.record(z.unknown())),
        nextCursor: z.string().nullable(),
      },
      annotations: {
        title: "Read monitors",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => {
      if (args.method !== "list" && !args.id) {
        return fail(`method=${args.method} needs id. Find one with method=list.`);
      }

      return run(deps, async () => {
        if (args.method === "get") {
          const monitor = await deps.v3.get(`/v3/monitors/${args.id}`);
          return { method: args.method, items: [monitor], nextCursor: null };
        }
        if (args.method === "matches") {
          const response = await deps.v3.get(`/v3/monitors/${args.id}/events`, {
            limit: args.limit,
            cursor: args.cursor,
          });
          return {
            method: args.method,
            notice: UNTRUSTED_NOTICE,
            items: asArray<Record<string, unknown>>(response.data),
            nextCursor: typeof response.nextCursor === "string" ? response.nextCursor : null,
          };
        }
        const response = await deps.v3.get("/v3/monitors");
        return {
          method: "list",
          items: asArray<Record<string, unknown>>(response.data),
          nextCursor: null,
        };
      });
    },
  );
}
