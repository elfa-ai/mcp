import { z } from "zod";
import type { TradableExchange } from "@elfa-ai/sdk";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { missingCredential } from "../errors.js";
import { fail, pickDefined, run } from "./util.js";

const EXCHANGES = ["hyperliquid", "gmx", "binance", "pacifica"] as const;

export function registerAutoExchanges(server: McpServer, deps: Deps): void {
  server.registerTool(
    "elfa_auto_exchanges",
    {
      title: "Auto exchange connections",
      description:
        "The exchange accounts Auto uses when a query's action places an order. Free. method=validate_symbol checks a symbol is tradeable before you build a query around it. Connecting and disconnecting change what Auto can trade with, so confirm with the user first, and both need request signing. binance and pacifica connect from here with credentials. hyperliquid and gmx use a wallet set up in the Elfa app, so use method=list to confirm those rather than trying to connect them.",
      inputSchema: {
        method: z
          .enum(["list", "connect", "disconnect", "validate_symbol"])
          .describe("Which action to perform."),
        exchange: z
          .enum(EXCHANGES)
          .optional()
          .describe("Required for connect, disconnect and validate_symbol."),
        symbol: z
          .string()
          .optional()
          .describe("Required for method=validate_symbol."),
        credentialType: z
          .string()
          .optional()
          .describe(
            "Credential type for method=connect, as documented per venue. Read it off an existing connection with method=list if you are unsure.",
          ),
        metadata: z
          .record(z.unknown())
          .optional()
          .describe("Non-secret connection metadata for method=connect."),
        credentials: z
          .record(z.unknown())
          .optional()
          .describe(
            "Venue credentials for method=connect. binance needs apiKey and secret, pacifica needs privateKey and walletAddress. They are verified on connect, so a wrong value fails here rather than at trade time. They also pass through the conversation and are written to the client transcript, so tell the user that before asking for them.",
          ),
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
      const needsExchange = args.method !== "list";

      if (needsExchange && !args.exchange) {
        return fail(
          `method=${args.method} needs exchange, one of ${EXCHANGES.join(", ")}.`,
        );
      }

      if (args.method === "validate_symbol" && !args.symbol) {
        return fail('method=validate_symbol needs symbol, for example symbol: "BTC".');
      }

      if (
        (args.method === "connect" || args.method === "disconnect") &&
        !deps.hasHmac
      ) {
        return fail(missingCredential("hmacSecret"));
      }

      if (args.method === "connect" && !args.credentialType) {
        return fail(
          "method=connect needs credentialType. See https://docs.elfa.ai/auto/trading-execution for the value each venue expects.",
        );
      }

      return run(deps, async () => {
        switch (args.method) {
          case "connect":
            return {
              method: args.method,
              data: await deps.sdk.auto.connectExchange(
                pickDefined({
                  exchange: args.exchange as TradableExchange,
                  credentialType: args.credentialType as string,
                  metadata: args.metadata,
                  credentials: args.credentials,
                }) as { exchange: TradableExchange; credentialType: string },
              ),
            };
          case "disconnect":
            return {
              method: args.method,
              data: await deps.sdk.auto.disconnectExchange(
                args.exchange as TradableExchange,
              ),
            };
          case "validate_symbol":
            return {
              method: args.method,
              data: await deps.sdk.auto.validateSymbol(
                args.exchange as TradableExchange,
                args.symbol as string,
              ),
            };
          default:
            return {
              method: "list",
              data: await deps.sdk.auto.listExchanges(),
            };
        }
      });
    },
  );
}
