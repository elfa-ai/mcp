import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { run, stripHandle } from "./util.js";

export function registerAccountStats(server: McpServer, deps: Deps): void {
  server.registerTool(
    "account_stats",
    {
      title: "Account stats",
      description:
        "Smart follower and engagement stats for an X account. 1 credit per call. Use it to judge whether an account's reach is real before weighting what it posts.",
      inputSchema: {
        username: z.string().describe("X username, with or without the @."),
      },
      outputSchema: {
        username: z.string(),
        followers: z.number().nullable(),
        smartFollowers: z.number().nullable(),
        smartFollowing: z.number().nullable(),
        averageEngagement: z.number().nullable(),
        averageReach: z.number().nullable(),
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
        const username = stripHandle(args.username);
        const response = await deps.sdk.getAccountSmartStats({ username });

        return {
          username,
          followers: response.data.followerCount ?? null,
          smartFollowers: response.data.smartFollowerCount ?? null,
          smartFollowing: response.data.smartFollowingCount ?? null,
          averageEngagement: response.data.averageEngagement ?? null,
          averageReach: response.data.averageReach ?? null,
        };
      }),
  );
}
