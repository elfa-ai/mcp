import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { fail, pickDefined, run } from "./util.js";

const ACTIVE = new Set(["active", "pending", "running", "armed"]);

export function registerAutoQuery(server: McpServer, deps: Deps): void {
  server.registerTool(
    "elfa_auto_query",
    {
      title: "Read Auto queries",
      description:
        "Read side of Auto. Free. method=list browses queries, method=get polls one query and returns its latest evaluation, method=executions and method=execution show what fired, method=sessions and method=session return the LLM analysis attached to a query. There is no push channel here, poll with method=get and respect pollAfterSeconds.",
      inputSchema: {
        method: z
          .enum([
            "list",
            "get",
            "executions",
            "execution",
            "sessions",
            "session",
          ])
          .describe("Which read to perform."),
        queryId: z
          .string()
          .optional()
          .describe("Required for get, sessions and session."),
        sessionId: z.string().optional().describe("Required for method=session."),
        executionId: z
          .string()
          .optional()
          .describe("Required for method=execution."),
        status: z.string().optional().describe("Filter by status."),
        type: z.string().optional().describe("Filter executions by type."),
        search: z.string().optional().describe("Free text filter for method=list."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe("Page size for list style methods."),
        offset: z.number().int().min(0).default(0).describe("Pagination offset."),
      },
      outputSchema: {
        method: z.string(),
        data: z.unknown(),
        pollAfterSeconds: z.number().nullable(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const needsQueryId =
        args.method === "get" ||
        args.method === "sessions" ||
        args.method === "session";

      if (needsQueryId && !args.queryId) {
        return fail(`method=${args.method} needs queryId. Find one with method=list.`);
      }

      if (args.method === "session" && !args.sessionId) {
        return fail("method=session needs sessionId. List them with method=sessions.");
      }

      if (args.method === "execution" && !args.executionId) {
        return fail(
          "method=execution needs executionId. List them with method=executions.",
        );
      }

      return run(deps, async () => {
        switch (args.method) {
          case "get": {
            const data = await deps.sdk.auto.getQuery(args.queryId as string);
            return {
              method: args.method,
              data,
              pollAfterSeconds: ACTIVE.has(String(data.status)) ? 30 : null,
            };
          }
          case "executions": {
            const data = await deps.sdk.auto.listExecutions(
              pickDefined({
                queryId: args.queryId,
                status: args.status,
                type: args.type,
                limit: args.limit,
                offset: args.offset,
              }),
            );
            return { method: args.method, data, pollAfterSeconds: null };
          }
          case "execution": {
            const data = await deps.sdk.auto.getExecution(
              args.executionId as string,
            );
            return { method: args.method, data, pollAfterSeconds: null };
          }
          case "sessions": {
            const data = await deps.sdk.auto.listSessions(args.queryId as string);
            return { method: args.method, data, pollAfterSeconds: null };
          }
          case "session": {
            const data = await deps.sdk.auto.getSession(
              args.queryId as string,
              args.sessionId as string,
            );
            return { method: args.method, data, pollAfterSeconds: null };
          }
          default: {
            const data = await deps.sdk.auto.listQueries(
              pickDefined({
                status: args.status,
                search: args.search,
                limit: args.limit,
                offset: args.offset,
              }),
            );
            return { method: "list", data, pollAfterSeconds: null };
          }
        }
      });
    },
  );
}
