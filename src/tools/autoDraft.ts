import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { fail, pickDefined, run } from "./util.js";

const TITLE = "Read Auto drafts";

export function registerAutoDraft(server: McpServer, deps: Deps): void {
  server.registerTool(
    "auto_draft",
    {
      title: TITLE,
      description:
        "Read side of Auto drafts. Free. method=list browses saved drafts, method=get returns one draft. A draft is an Auto query parked without activating it: it never evaluates and never fires.",
      inputSchema: {
        method: z.enum(["list", "get"]).describe("Which read to perform."),
        draftId: z.string().optional().describe("Required for method=get."),
        status: z.string().optional().describe("Filter for method=list."),
        search: z.string().optional().describe("Free text filter for method=list."),
        limit: z.number().int().min(1).max(50).default(10).describe("Page size."),
        offset: z.number().int().min(0).default(0).describe("Pagination offset."),
      },
      outputSchema: {
        method: z.string(),
        data: z.unknown(),
      },
      annotations: {
        title: TITLE,
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (args.method === "get" && !args.draftId) {
        return fail("method=get needs draftId. Find one with method=list.");
      }

      return run(deps, async () => {
        if (args.method === "get") {
          return {
            method: args.method,
            data: await deps.sdk.auto.getDraft(args.draftId as string),
          };
        }

        return {
          method: "list",
          data: await deps.sdk.auto.listDrafts(
            pickDefined({
              status: args.status,
              search: args.search,
              limit: args.limit,
              offset: args.offset,
            }),
          ),
        };
      });
    },
  );
}
