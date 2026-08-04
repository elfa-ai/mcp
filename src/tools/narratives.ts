import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { asArray, UNTRUSTED_NOTICE } from "../shape.js";
import { fail, fromArg, pickDefined, run, timeWindowArg, toArg } from "./util.js";

export function registerNarratives(server: McpServer, deps: Deps): void {
  server.registerTool(
    "elfa_narratives",
    {
      title: "Narratives",
      description:
        "Written narrative analysis with source links, for when counts are not enough. 5 credits per call, so prefer elfa_trending or elfa_mentions when metrics will do. scope=market extracts the narratives moving the market. scope=keywords summarises events for keywords you supply.",
      inputSchema: {
        scope: z
          .enum(["market", "keywords"])
          .default("market")
          .describe("market is a broad sweep. keywords needs the keywords argument."),
        keywords: z
          .string()
          .optional()
          .describe("Up to 5 comma separated keywords for scope=keywords."),
        searchType: z
          .enum(["and", "or"])
          .optional()
          .describe("How multiple keywords combine for scope=keywords."),
        timeFrame: z
          .enum(["day", "week"])
          .optional()
          .describe("Lookback for scope=market."),
        maxNarratives: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Cap the narratives returned for scope=market."),
        maxTweetsPerNarrative: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Cap the sources per narrative for scope=market."),
        timeWindow: timeWindowArg,
        from: fromArg,
        to: toArg,
      },
      outputSchema: {
        scope: z.string(),
        notice: z.string(),
        items: z.array(z.record(z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (args.scope === "keywords" && !args.keywords) {
        return fail(
          'scope=keywords needs the keywords argument. Retry with keywords set, for example keywords: "ethereum,upgrade".',
        );
      }

      const keywordCount = args.keywords?.split(",").length ?? 0;
      if (keywordCount > 5) {
        return fail(
          `Too many keywords: ${keywordCount}. Pass at most 5, comma separated, and run a second call for the rest.`,
        );
      }

      return run(deps, async () => {
        if (args.scope === "keywords") {
          const response = await deps.sdk.getEventSummary(
            pickDefined({
              keywords: args.keywords as string,
              timeWindow: args.timeWindow,
              from: args.from,
              to: args.to,
              searchType: args.searchType,
            }) as { keywords: string },
          );

          return {
            scope: args.scope,
            notice: UNTRUSTED_NOTICE,
            items: asArray<{ summary: string; sourceLinks: string[] }>(
              response.data,
            ).map((entry) => ({
              summary: entry.summary,
              sources: asArray<string>(entry.sourceLinks),
            })),
          };
        }

        const response = await deps.sdk.getTrendingNarratives(
          pickDefined({
            timeFrame: args.timeFrame,
            maxNarratives: args.maxNarratives,
            maxTweetsPerNarrative: args.maxTweetsPerNarrative,
          }),
        );

        return {
          scope: args.scope,
          notice: UNTRUSTED_NOTICE,
          items: asArray<{ narrative: string; source_links: string[] }>(
            response.data?.trending_narratives,
          ).map((entry) => ({
            narrative: entry.narrative,
            sources: asArray<string>(entry.source_links),
          })),
        };
      });
    },
  );
}
