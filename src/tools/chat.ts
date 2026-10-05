import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { fail, pickDefined, run, stripHandle } from "./util.js";

/** A link the research behind the answer read (`data.sources` on /v2/chat). */
export interface ChatSource {
  url: string;
  kind: string;
  title?: string;
}

/**
 * Keeps well-formed entries only. `kind` stays a free string: the API adds
 * kinds in minor releases, and an unknown one should read as `web`.
 */
export function readSources(value: unknown): ChatSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ChatSource[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { url, kind, title } = item as Record<string, unknown>;
    if (typeof url !== "string" || typeof kind !== "string") continue;
    sources.push(typeof title === "string" ? { url, kind, title } : { url, kind });
  }
  return sources;
}

export function registerChat(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "market_chat",
    {
      title: "Market chat",
      description:
        "Ask Elfa for written market analysis grounded in its social data. Costs credits and varies by speed, so fast is the cheaper option. Pass sessionId from a previous reply to continue the same conversation. The reply includes sources: links to the posts and pages the research read (links only, not their text), so you can cite or check them.",
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
        sources: z
          .array(
            z.object({
              url: z.string(),
              kind: z.string(),
              title: z.string().optional(),
            }),
          )
          .describe(
            "Links the research read, in order, without duplicates. kind is x_post, x_account, telegram, dex, explorer, prediction_market or web; treat any other value as web. A source was read, not necessarily cited.",
          ),
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
        // includeSources (API 2.8.1) is newer than the SDK's ChatParams type;
        // the SDK posts params unchanged, so the flag reaches /v2/chat.
        const response = await deps.sdk.chat(
          pickDefined({
            analysisType: type,
            speed: args.speed,
            message: args.message,
            sessionId: args.sessionId,
            assetMetadata:
              Object.keys(assetMetadata).length > 0 ? assetMetadata : undefined,
            includeSources: true,
          }) as Parameters<Deps["sdk"]["chat"]>[0],
        );
        const data = response.data as typeof response.data & { sources?: unknown };

        return {
          message: data.message,
          sessionId: data.sessionId ?? null,
          creditsConsumed: data.creditsConsumed ?? null,
          sources: readSources(data.sources),
        };
      });
    },
  );
}
