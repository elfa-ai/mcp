import { z } from "zod";
import type { EqlQuery } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { missingCredential } from "../errors.js";
import { eqlQueryArg, fail, requiresSignature, pickDefined, run } from "./util.js";

export function registerAutoQueryWrite(server: McpServer, deps: Deps): void {
  server.registerTool(
    "auto_query_write",
    {
      title: "Write Auto queries",
      description:
        "Activate, cancel or delete an Auto query. Creating costs 5 credits plus LLM usage, cancel and delete are free. An activated query runs unattended and fires its action without asking again, so validate it with auto_validate and confirm the cost and the action with the user before calling this. Queries whose action places an order also need request signing.",
      inputSchema: {
        method: z
          .enum(["create", "cancel", "delete"])
          .describe(
            "create activates a new query. cancel stops an active one. delete removes one that has already finished.",
          ),
        query: eqlQueryArg.optional(),
        title: z
          .string()
          .max(120)
          .optional()
          .describe("Short title shown in the notification when this fires."),
        description: z
          .string()
          .max(500)
          .optional()
          .describe("Why this was set up, shown alongside the title."),
        queryId: z
          .string()
          .optional()
          .describe("Required for cancel and delete."),
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
      if (args.method === "create") {
        if (!args.query) {
          return fail("method=create needs a query. Build one with auto_build.");
        }
        if (requiresSignature(args.query) && !deps.hasHmac) {
          return fail(missingCredential("hmacSecret"));
        }
      } else if (!args.queryId) {
        return fail(`method=${args.method} needs queryId. Find one with auto_query.`);
      }

      return run(deps, async () => {
        if (args.method === "create") {
          const data = await deps.sdk.auto.createQuery(
            pickDefined({
              query: args.query as unknown as EqlQuery,
              title: args.title,
              description: args.description,
            }) as { query: EqlQuery },
          );
          return { method: args.method, data };
        }

        const data =
          args.method === "cancel"
            ? await deps.sdk.auto.cancelQuery(args.queryId as string)
            : await deps.sdk.auto.deleteQuery(args.queryId as string);

        return { method: args.method, data };
      });
    },
  );
}
