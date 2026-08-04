import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { run } from "./util.js";

export function registerStatus(server: McpServer, deps: Deps): void {
  server.registerTool(
    "elfa_status",
    {
      title: "API key status",
      description:
        "Check the Elfa API key tier, credit usage and remaining requests, and confirm the API is reachable. Free. Call this first when a request fails with an auth or credit error.",
      inputSchema: {},
      outputSchema: {
        reachable: z.boolean(),
        key: z.record(z.unknown()).nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () =>
      run(deps, async () => {
        const [ping, status] = await Promise.allSettled([
          deps.sdk.ping(),
          deps.sdk.getApiKeyStatus(),
        ]);

        return {
          reachable: ping.status === "fulfilled",
          key:
            status.status === "fulfilled"
              ? (status.value.data as unknown as Record<string, unknown>)
              : null,
        };
      }),
  );
}
