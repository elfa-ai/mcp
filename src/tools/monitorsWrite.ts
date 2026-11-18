import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { V3ApiError, V3RedirectError } from "../v3.js";
import { fail, pickDefined, run } from "./util.js";

const READ_FIRST = "The change may still have been applied, so read the monitors with the monitors tool before retrying.";

async function unsure(write: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof V3RedirectError) throw error;
    if (error instanceof V3ApiError) {
      if (error.statusCode < 500) throw error;
      throw new Error(`Elfa API error (${error.statusCode}): ${error.message}. ${READ_FIRST}`);
    }
    throw new Error(`${error instanceof Error ? error.message : String(error)} ${READ_FIRST}`);
  }
}

export function registerMonitorsWrite(server: McpServer, deps: Deps): void {
  server.registerTool(
    "monitors_write",
    {
      title: "Write monitors",
      description:
        "Create, update or delete a monitor. A monitor checks each new Elfa event against a plain-words query, and searches the web for it every hour, and POSTs each match to webhookUrl, signed with Standard Webhooks. It reports only what appears after it is created, and runs unattended until deleted. A live monitor costs 2 credits for each started hour, the first hour on create, which is 1,440 credits for a 30-day month; update and delete are free, and a failed create is never charged. A key holds 20 live monitors. create returns the monitor with webhookSecret, which verifies its webhook signatures and never changes. update changes query, webhookUrl or both and keeps the id and secret; a monitor takes one change at a time, and an ended one cannot be changed. delete stops it, and no hour after the delete is charged. If create or update times out or answers 503, the change may still apply: read the monitors before retrying.",
      inputSchema: {
        method: z
          .enum(["create", "update", "delete"])
          .describe("create starts a new monitor. update changes one. delete stops and removes one."),
        id: z.string().uuid().optional().describe("Required for update and delete."),
        query: z
          .string()
          .min(3)
          .max(500)
          .optional()
          .describe(
            'What should match, in plain words, 3 to 500 characters, such as "Binance announces it will delist a token". It is the whole condition, matched by meaning: search syntax and time ranges add nothing. Required for create.',
          ),
        webhookUrl: z
          .string()
          .url()
          .max(2048)
          .optional()
          .describe(
            "An https URL on a public host that receives each match. Private and reserved addresses are refused. Required for create.",
          ),
      },
      outputSchema: {
        method: z.string(),
        data: z.unknown(),
      },
      annotations: {
        title: "Write monitors",
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      if (args.webhookUrl && !args.webhookUrl.toLowerCase().startsWith("https://")) {
        return fail("webhookUrl must be an https URL on a public host.");
      }
      if (args.method === "create" && (!args.query || !args.webhookUrl)) {
        return fail("method=create needs query and webhookUrl.");
      }
      if (args.method !== "create" && !args.id) {
        return fail(`method=${args.method} needs id. Find one with monitors method=list.`);
      }
      if (args.method === "update" && !args.query && !args.webhookUrl) {
        return fail("method=update needs query, webhookUrl or both.");
      }

      return run(deps, async () => {
        if (args.method === "delete") {
          return { method: args.method, data: await deps.v3.send("DELETE", `/v3/monitors/${args.id}`) };
        }
        const body = pickDefined({ query: args.query, webhookUrl: args.webhookUrl });
        const data = await unsure(() =>
          args.method === "create"
            ? deps.v3.send("POST", "/v3/monitors", body)
            : deps.v3.send("PATCH", `/v3/monitors/${args.id}`, body),
        );
        return { method: args.method, data };
      });
    },
  );
}
