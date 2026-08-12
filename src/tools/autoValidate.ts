import { z } from "zod";
import type { EqlQuery, TradableExchange } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { asArray } from "../shape.js";
import { eqlQueryArg, fail, pickDefined, run } from "./util.js";

const EXCHANGES = ["hyperliquid", "gmx", "binance", "pacifica"] as const;

export function registerAutoValidate(server: McpServer, deps: Deps): void {
  server.registerTool(
    "auto_validate",
    {
      title: "Validate Auto query",
      description:
        "Check EQL syntax and get a cost estimate before anything is activated. Free. Always run this before auto_query_write, and show the estimated cost to the user. Pass either an inline query or a draftId. method=symbol instead checks that a symbol has market data on a venue, before you build price or ta conditions around it.",
      inputSchema: {
        method: z
          .enum(["query", "symbol"])
          .default("query")
          .describe("query validates EQL, symbol checks symbol support."),
        query: eqlQueryArg.optional(),
        draftId: z
          .string()
          .optional()
          .describe("Validate a stored draft instead of an inline query."),
        title: z.string().max(120).optional().describe("Title to validate with the query."),
        description: z
          .string()
          .max(500)
          .optional()
          .describe("Description to validate with the query."),
        exchange: z
          .enum(EXCHANGES)
          .optional()
          .describe("Required for method=symbol."),
        symbol: z
          .string()
          .optional()
          .describe('Required for method=symbol, for example "BTC".'),
      },
      outputSchema: {
        valid: z.boolean(),
        errors: z.array(z.unknown()),
        warnings: z.array(z.unknown()),
        estimatedCredits: z.number().nullable(),
        estimatedCost: z.record(z.unknown()).nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (args.method === "symbol") {
        if (!args.exchange || !args.symbol) {
          return fail(
            `method=symbol needs exchange, one of ${EXCHANGES.join(", ")}, and symbol.`,
          );
        }

        const exchange = args.exchange as TradableExchange;
        const symbol = args.symbol;

        return run(deps, async () => {
          const response = await deps.sdk.auto.validateSymbol(exchange, symbol);
          const supported = response.supported === "true";

          return {
            valid: supported,
            errors: supported
              ? []
              : [`${symbol} has no market data on ${exchange}.`],
            warnings: [],
            estimatedCredits: null,
            estimatedCost: null,
          };
        });
      }

      if (!args.query && !args.draftId) {
        return fail("Pass either query or draftId. Retry with one of them set.");
      }

      return run(deps, async () => {
        const response = args.draftId
          ? await deps.sdk.auto.validateDraft(args.draftId)
          : await deps.sdk.auto.validateQuery(
              pickDefined({
                query: args.query as unknown as EqlQuery,
                title: args.title,
                description: args.description,
              }) as { query: EqlQuery },
            );

        return {
          valid: response.valid === true,
          errors: asArray<unknown>(response.errors),
          warnings: asArray<unknown>(response.warnings),
          estimatedCredits: response.estimatedCredits ?? null,
          estimatedCost:
            (response.estimatedCost as Record<string, unknown> | undefined) ??
            null,
        };
      });
    },
  );
}
