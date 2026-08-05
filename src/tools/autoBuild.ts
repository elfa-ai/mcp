import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { asArray } from "../shape.js";
import { pickDefined, run } from "./util.js";

export function registerAutoBuild(server: McpServer, deps: Deps): void {
  server.registerTool(
    "auto_build",
    {
      title: "Auto query builder",
      description:
        "Turn a plain-language monitoring request into an EQL query. Costs 1 credit plus LLM usage. This only drafts the query, nothing starts running until you activate it with auto_query_write. Say what to watch, the threshold, and what should happen when it fires.",
      inputSchema: {
        message: z
          .string()
          .describe(
            'What to monitor, in plain language, for example "tell me on Telegram when BTC funding on Binance goes negative".',
          ),
        speed: z
          .enum(["fast", "expert", "adaptive"])
          .default("fast")
          .describe("fast is cheaper, expert reasons more deeply about the query."),
        sessionId: z
          .string()
          .optional()
          .describe("Continue refining a query from an earlier reply."),
      },
      outputSchema: {
        sessionId: z.string().nullable(),
        response: z.string().nullable(),
        title: z.string().nullable(),
        reasoning: z.string().nullable(),
        planIds: z.array(z.string()),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) =>
      run(deps, async () => {
        const response = await deps.sdk.auto.chat(
          pickDefined({
            message: args.message,
            speed: args.speed,
            sessionId: args.sessionId,
          }) as { message: string },
        );

        return {
          sessionId: response.sessionId ?? null,
          response: response.response ?? null,
          title: response.title ?? null,
          reasoning: response.reasoning ?? null,
          planIds: asArray<string>(response.planIds),
        };
      }),
  );
}
