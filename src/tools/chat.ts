import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { fail, pickDefined, run, stripHandle } from "./util.js";

export function registerChat(server: McpServer, deps: Deps): void {
  server.registerTool(
    "elfa_chat",
    {
      title: "Market chat",
      description:
        "Ask Elfa for written market analysis grounded in its social data. Costs credits and varies by speed, so fast is the cheaper option. Pass sessionId from a previous reply to continue the same conversation.",
      inputSchema: {
        analysisType: z
          .enum([
            "chat",
            "macro",
            "summary",
            "tokenIntro",
            "tokenAnalysis",
            "accountAnalysis",
          ])
          .default("chat")
          .describe(
            "chat needs message. tokenIntro and tokenAnalysis need symbol, or chain plus contractAddress. accountAnalysis needs username. macro and summary need nothing else.",
          ),
        message: z
          .string()
          .optional()
          .describe("The question, required for analysisType=chat."),
        sessionId: z
          .string()
          .optional()
          .describe("Continue an earlier conversation."),
        speed: z
          .enum(["fast", "expert", "adaptive"])
          .default("fast")
          .describe(
            "Defaults to fast, which is cheaper and shallower. Ask for expert when the answer needs deeper reasoning.",
          ),
        symbol: z.string().optional().describe("Token symbol, for token analysis."),
        chain: z.string().optional().describe("Chain, paired with contractAddress."),
        contractAddress: z
          .string()
          .optional()
          .describe("Contract address, paired with chain."),
        username: z
          .string()
          .optional()
          .describe("X username, for analysisType=accountAnalysis."),
      },
      outputSchema: {
        message: z.string(),
        sessionId: z.string().nullable(),
        creditsConsumed: z.number().nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const type = args.analysisType;

      if (type === "chat" && !args.message) {
        return fail("analysisType=chat needs a message. Retry with the question in message.");
      }

      if (
        (type === "tokenIntro" || type === "tokenAnalysis") &&
        !args.symbol &&
        !(args.chain && args.contractAddress)
      ) {
        return fail(
          `analysisType=${type} needs symbol, or chain plus contractAddress. Retry with one of those.`,
        );
      }

      if (type === "accountAnalysis" && !args.username) {
        return fail("analysisType=accountAnalysis needs a username. Retry with username set.");
      }

      const assetMetadata = pickDefined({
        symbol: args.symbol,
        chain: args.chain,
        contractAddress: args.contractAddress,
        username: args.username ? stripHandle(args.username) : undefined,
      });

      return run(deps, async () => {
        const response = await deps.sdk.chat(
          pickDefined({
            analysisType: type,
            speed: args.speed,
            message: args.message,
            sessionId: args.sessionId,
            assetMetadata:
              Object.keys(assetMetadata).length > 0 ? assetMetadata : undefined,
          }),
        );

        return {
          message: response.data.message,
          sessionId: response.data.sessionId ?? null,
          creditsConsumed: response.data.creditsConsumed ?? null,
        };
      });
    },
  );
}
