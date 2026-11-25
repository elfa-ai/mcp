import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { fail, run } from "./util.js";

// Enterprise docs for agents (elfa-docs enterprise/DESIGN-fragments.md §16,
// oracle GET /v2/docs/enterprise): the enterprise endpoints this key may
// call, documented. Without an id, an index; with one, that doc's markdown
// and endpoint entry, so many docs never run into the response cap.

interface Fragment {
  id: string;
  title: string | null;
  markdown: string;
  endpoints: Record<string, unknown>[];
}

const isFragment = (value: unknown): value is Fragment => {
  if (!value || typeof value !== "object") return false;
  const f = value as Record<string, unknown>;
  return (
    typeof f.id === "string" &&
    typeof f.markdown === "string" &&
    (f.title === null || typeof f.title === "string") &&
    Array.isArray(f.endpoints)
  );
};

async function fetchFragments(deps: Deps): Promise<Fragment[]> {
  const body = await deps.v3.get("/v2/docs/enterprise");
  const data = body.data as { fragments?: unknown } | undefined;
  const fragments = Array.isArray(data?.fragments) ? data.fragments : [];
  return fragments.filter(isFragment);
}

export function registerEnterpriseDocs(server: McpServer, deps: Deps): void {
  server.registerTool(
    "enterprise_docs",
    {
      title: "Enterprise docs",
      description:
        "Documentation for the enterprise endpoints this API key can call, which the public docs do not list. Free. Call it without an id for the list, then with an id for that endpoint's full docs: parameters, responses and examples. An empty list means the key has no enterprise endpoints.",
      inputSchema: {
        id: z
          .string()
          .regex(/^f_[a-z2-7]{8}$/)
          .optional()
          .describe("A doc id from the list, for that endpoint's full docs."),
      },
      outputSchema: {
        docs: z
          .array(
            z.object({
              id: z.string(),
              title: z.string().nullable(),
              method: z.string().nullable(),
              path: z.string().nullable(),
            }),
          )
          .optional(),
        doc: z
          .object({
            id: z.string(),
            title: z.string().nullable(),
            markdown: z.string(),
            endpoints: z.array(z.record(z.unknown())),
          })
          .optional(),
      },
      annotations: {
        title: "Enterprise docs",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      if (args.id === undefined) {
        return run(deps, async () => ({
          docs: (await fetchFragments(deps)).map((f) => {
            const endpoint = f.endpoints[0] ?? {};
            return {
              id: f.id,
              title: f.title,
              method: typeof endpoint.method === "string" ? endpoint.method : null,
              path: typeof endpoint.path === "string" ? endpoint.path : null,
            };
          }),
        }));
      }
      let found: Fragment | undefined;
      const result = await run(deps, async () => {
        found = (await fetchFragments(deps)).find((f) => f.id === args.id);
        return found ? { doc: found } : {};
      });
      if (!result.isError && !found) {
        return fail(
          `No enterprise doc ${args.id} for this key. Call enterprise_docs without an id for the list.`,
        );
      }
      return result;
    },
  );
}
