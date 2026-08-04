import { z } from "zod";
import type { EqlQuery } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { missingCredential } from "../errors.js";
import { eqlQueryArg, fail, requiresSignature, pickDefined, run } from "./util.js";

export function registerAutoDraft(server: McpServer, deps: Deps): void {
  server.registerTool(
    "elfa_auto_draft",
    {
      title: "Auto drafts",
      description:
        "Park an Auto query without activating it. Drafts never evaluate and never fire. Free, except method=convert which activates the draft and costs the same as creating a query. Use drafts when the user is still deciding.",
      inputSchema: {
        method: z
          .enum(["list", "get", "upsert", "delete", "convert"])
          .describe(
            "upsert creates or updates a draft. convert activates it as a live query.",
          ),
        draftId: z
          .string()
          .optional()
          .describe("Required for get, delete and convert. Optional on upsert to update."),
        query: eqlQueryArg.optional(),
        title: z.string().max(120).optional().describe("Title carried into the live query."),
        description: z
          .string()
          .max(500)
          .optional()
          .describe("Description carried into the live query."),
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
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (args.method === "upsert") {
        if (!args.query) {
          return fail("method=upsert needs a query. Build one with elfa_auto_build.");
        }
        if (requiresSignature(args.query) && !deps.hasHmac) {
          return fail(missingCredential("hmacSecret"));
        }
      }

      const needsId =
        args.method === "get" ||
        args.method === "delete" ||
        args.method === "convert";

      if (needsId && !args.draftId) {
        return fail(`method=${args.method} needs draftId. Find one with method=list.`);
      }

      return run(deps, async () => {
        switch (args.method) {
          case "get":
            return {
              method: args.method,
              data: await deps.sdk.auto.getDraft(args.draftId as string),
            };
          case "upsert":
            return {
              method: args.method,
              data: await deps.sdk.auto.upsertDraft(
                pickDefined({
                  id: args.draftId,
                  query: args.query as unknown as EqlQuery,
                  title: args.title,
                  description: args.description,
                }) as { query: EqlQuery },
              ),
            };
          case "delete":
            return {
              method: args.method,
              data: await deps.sdk.auto.deleteDraft(args.draftId as string),
            };
          case "convert":
            return {
              method: args.method,
              data: await deps.sdk.auto.convertDraft(args.draftId as string),
            };
          default:
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
        }
      });
    },
  );
}
