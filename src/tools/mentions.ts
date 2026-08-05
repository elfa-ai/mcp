import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { asArray, UNTRUSTED_NOTICE, shapeMention } from "../shape.js";
import {
  asVerbosity,
  fail,
  pageArg,
  pageSizeArg,
  pickDefined,
  repostsArg,
  run,
  timeWindowArg,
  toArg,
  verbosityArg,
} from "./util.js";

export function registerMentions(server: McpServer, deps: Deps): void {
  server.registerTool(
    "mentions",
    {
      title: "Mentions",
      description:
        "Social mentions from X and Telegram. 1 credit per call. Returns engagement metrics and a link per post, not the post text. mode=top ranks one ticker's mentions by engagement. mode=search filters by keywords or by account. mode=news returns the token news feed.",
      inputSchema: {
        mode: z
          .enum(["top", "search", "news"])
          .describe(
            "top needs ticker. search needs keywords or accountName. news is a feed and needs neither.",
          ),
        ticker: z
          .string()
          .optional()
          .describe('Ticker for mode=top, for example "BTC" or "$SOL".'),
        keywords: z
          .string()
          .optional()
          .describe("Up to 5 comma separated keywords for mode=search."),
        accountName: z
          .string()
          .optional()
          .describe("X username for mode=search, without the @."),
        coinIds: z
          .string()
          .optional()
          .describe("Comma separated CoinGecko coin ids to filter mode=news."),
        searchType: z
          .enum(["and", "or"])
          .optional()
          .describe("How multiple keywords combine in mode=search."),
        timeWindow: timeWindowArg,
        from: z
          .number()
          .int()
          .optional()
          .describe(
            "Start of an absolute range, unix seconds. Use with to. For mode=search the range must span at least 1 day and at most 30.",
          ),
        to: toArg,
        page: pageArg,
        pageSize: pageSizeArg,
        limit: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(10)
          .describe("Result count for mode=search."),
        cursor: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous mode=search response."),
        reposts: repostsArg,
        verbosity: verbosityArg,
      },
      outputSchema: {
        mode: z.string(),
        notice: z.string(),
        total: z.number().nullable(),
        next: z.string().nullable(),
        mentions: z.array(z.record(z.unknown())),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const view = asVerbosity(args.verbosity);

      if (args.mode === "top" && !args.ticker) {
        return fail("mode=top needs a ticker. Retry with ticker set, for example ticker: \"BTC\".");
      }

      if (args.mode === "search" && !args.keywords && !args.accountName) {
        return fail(
          "mode=search needs keywords or accountName. Retry with one of them set, for example keywords: \"bitcoin,etf\".",
        );
      }

      const keywordCount = args.keywords?.split(",").length ?? 0;
      if (keywordCount > 5) {
        return fail(
          `Too many keywords: ${keywordCount}. Pass at most 5, comma separated, and run a second call for the rest.`,
        );
      }

      if (args.from !== undefined && args.to !== undefined) {
        const span = args.to - args.from;
        if (args.mode === "search" && (span < 86400 || span > 2592000)) {
          return fail(
            "For mode=search the range between from and to must be at least 1 day and at most 30 days. Adjust the range, or use timeWindow instead.",
          );
        }
      }

      return run(deps, async () => {
        if (args.mode === "top") {
          const response = await deps.sdk.getTopMentions(
            pickDefined({
              ticker: args.ticker as string,
              timeWindow: args.timeWindow,
              from: args.from,
              to: args.to,
              page: args.page,
              pageSize: args.pageSize,
              reposts: args.reposts,
            }) as { ticker: string },
          );

          return {
            mode: "top",
            notice: UNTRUSTED_NOTICE,
            total: response.metadata?.total ?? null,
            next:
              response.metadata &&
              response.metadata.page * response.metadata.pageSize <
                response.metadata.total
                ? `page=${response.metadata.page + 1}`
                : null,
            mentions: asArray<Parameters<typeof shapeMention>[0]>(
              response.data,
            ).map((item) => shapeMention(item, view)),
          };
        }

        if (args.mode === "news") {
          const response = await deps.sdk.getTokenNews(
            pickDefined({
              timeWindow: args.timeWindow,
              from: args.from,
              to: args.to,
              page: args.page,
              pageSize: args.pageSize,
              coinIds: args.coinIds,
              reposts: args.reposts,
            }),
          );

          return {
            mode: "news",
            notice: UNTRUSTED_NOTICE,
            total: response.metadata?.total ?? null,
            next:
              response.metadata &&
              response.metadata.page * response.metadata.pageSize <
                response.metadata.total
                ? `page=${response.metadata.page + 1}`
                : null,
            mentions: asArray<Parameters<typeof shapeMention>[0]>(
              response.data,
            ).map((item) => shapeMention(item, view)),
          };
        }

        const response = await deps.sdk.getKeywordMentions(
          pickDefined({
            keywords: args.keywords,
            accountName: args.accountName,
            timeWindow: args.timeWindow,
            from: args.from,
            to: args.to,
            limit: args.limit,
            searchType: args.searchType,
            cursor: args.cursor,
            reposts: args.reposts,
          }),
        );

        return {
          mode: "search",
          notice: UNTRUSTED_NOTICE,
          total: response.metadata?.total ?? null,
          next: response.metadata?.cursor
            ? `cursor=${response.metadata.cursor}`
            : null,
          mentions: asArray<Parameters<typeof shapeMention>[0]>(
            response.data,
          ).map((item) => shapeMention(item, view)),
        };
      });
    },
  );
}
