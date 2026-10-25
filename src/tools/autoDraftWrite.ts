import { z } from "zod";
import type { EqlQuery } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { eqlQueryArg, fail, pickDefined, rejectCredentials, run } from "./util.js";

const TITLE = "Write Auto drafts";

export function registerAutoDraftWrite(server: McpServer, deps: Deps): void {
  server.registerTool(
    "auto_draft_write",
    {
      title: TITLE,
      description:
        "Create, update, delete or activate an Auto draft. method=upsert parks a query as a draft without activating it; drafts never evaluate and never fire. method=delete removes a draft. method=convert activates a draft as a live query, which runs unattended and fires its action without asking again, and costs the same as creating a query. upsert and delete are free.",
      inputSchema: {
        method: z
          .enum(["upsert", "delete", "convert"])
          .describe(
            "upsert creates or updates a draft. delete removes one. convert activates it as a live query.",
          ),
        draftId: z
          .string()
          .optional()
          .describe("Required for delete and convert. Optional on upsert to update."),
        query: eqlQueryArg.optional(),
        title: z.string().max(120).optional().describe("Title carried into the live query."),
        description: z
          .string()
          .max(500)
          .optional()
          .describe("Description carried into the live query."),
      },
      outputSchema: {
        method: z.string(),
        data: z.unknown(),
      },
      annotations: {
        title: TITLE,
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      if (args.method === "upsert") {
        if (!args.query) {
          return fail("method=upsert needs a query. Build one with auto_build.");
        }
        const credential = rejectCredentials(args.query);
        if (credential) return credential;
      } else if (!args.draftId) {
        return fail(`method=${args.method} needs draftId. Find one with auto_draft.`);
      }

      return run(deps, async () => {
        switch (args.method) {
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
          default:
            return {
              method: "convert",
              data: await deps.sdk.auto.convertDraft(args.draftId as string),
            };
        }
      });
    },
  );
}
