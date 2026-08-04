import { z } from "zod";
import type { TrendingContractAddress, TrendingToken } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { asArray } from "../shape.js";
import { fromArg, pageArg, pageSizeArg, pickDefined, run, toArg } from "./util.js";

export function registerTrending(server: McpServer, deps: Deps): void {
  server.registerTool(
    "elfa_trending",
    {
      title: "Trending",
      description:
        "What is gaining social attention right now. 1 credit per call. scope=tokens returns tickers ranked by mention volume with the change against the previous window. scope=contracts_twitter and scope=contracts_telegram return trending contract addresses.",
      inputSchema: {
        scope: z
          .enum(["tokens", "contracts_twitter", "contracts_telegram"])
          .default("tokens")
          .describe("Which trending list to return."),
        timeWindow: z
          .string()
          .optional()
          .describe(
            'Relative window such as "24h" or "7d". Defaults to 24h unless both from and to are given.',
          ),
        from: fromArg,
        to: toArg,
        page: pageArg,
        pageSize: pageSizeArg,
        minMentions: z
          .number()
          .int()
          .min(1)
          .default(5)
          .describe("Drop entries below this mention count."),
      },
      outputSchema: {
        scope: z.string(),
        page: z.number().nullable(),
        pageSize: z.number().nullable(),
        total: z.number().nullable(),
        items: z.array(z.record(z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      run(deps, async () => {
        const hasRange = args.from !== undefined && args.to !== undefined;

        const params = pickDefined({
          timeWindow: args.timeWindow ?? (hasRange ? undefined : "24h"),
          from: args.from,
          to: args.to,
          page: args.page,
          pageSize: args.pageSize,
          minMentions: args.minMentions,
        });

        if (args.scope === "tokens") {
          const response = await deps.sdk.getTrendingTokens(params);
          return {
            scope: args.scope,
            page: response.data?.page ?? null,
            pageSize: response.data?.pageSize ?? null,
            total: response.data?.total ?? null,
            items: asArray<TrendingToken>(response.data?.data).map((token) => ({
              token: token.token,
              mentions: token.current_count,
              previousMentions: token.previous_count,
              changePercent: token.change_percent,
            })),
          };
        }

        const response =
          args.scope === "contracts_twitter"
            ? await deps.sdk.getTrendingCAsTwitter(params)
            : await deps.sdk.getTrendingCAsTelegram(params);

        return {
          scope: args.scope,
          page: response.data?.page ?? null,
          pageSize: response.data?.pageSize ?? null,
          total: response.data?.total ?? null,
          items: asArray<TrendingContractAddress>(response.data?.data).map(
            (entry) => ({
              contractAddress: entry.contractAddress,
              chain: entry.chain,
              mentions: entry.mentionCount,
            }),
          ),
        };
      }),
  );
}
