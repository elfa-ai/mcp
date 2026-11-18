import { z } from "zod";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../client.js";
import { pickDefined, run } from "./util.js";

const decisionArg = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("yesNo"),
      yes: z.string().max(500).optional().describe("What counts as yes."),
      no: z.string().max(500).optional().describe("What counts as no."),
    }),
    z.object({
      type: z.literal("choice"),
      options: z
        .array(
          z.object({
            label: z.string().min(1).max(100).describe("Unique within the request."),
            definition: z.string().min(1).max(500).describe("When this option applies."),
          }),
        )
        .min(2)
        .max(20),
    }),
    z.object({
      type: z.literal("score"),
      levels: z.array(z.string().min(1).max(200)).min(2).max(10).describe("Lowest first."),
    }),
  ])
  .optional()
  .describe(
    "One more question asked of the same evidence, at no extra cost. yesNo returns yes, the probability the answer is yes. choice returns the most likely label and a probability per label. score returns the expected level, counted from 0, and a probability per level. Null in the result when nothing was found.",
  );

export function registerVerify(server: McpServer, deps: Deps): RegisteredTool {
  return server.registerTool(
    "verify",
    {
      title: "Verify",
      description:
        "Check whether one claim is true against X posts and public Telegram channels from the 7 days before asOf, and web pages published by then. 1 credit per call whatever the verdict; errors cost nothing. verdict is supported, contradicted or notEnoughEvidence, which means unknown, not false, and also covers a most likely verdict under 0.5. probabilities gives each verdict. evidence holds up to 10 links in all, in one list per source (twitter, telegram, web), most decisive first; basis marks the up to 3 the verdict rests on. coverage.complete false means a source did not answer in time, so the verdict may have missed something. No post or page text is returned, only links.",
      inputSchema: {
        statement: z
          .string()
          .min(1)
          .max(500)
          .describe(
            "One checkable claim, as a sentence: who, what and when. Two claims get one verdict.",
          ),
        context: z
          .string()
          .max(4000)
          .optional()
          .describe(
            "Background for the judgement, such as how a prediction market resolves. Never treated as evidence, and it does not change what is searched.",
          ),
        asOf: z
          .number()
          .optional()
          .describe(
            "Unix seconds. Judge the claim as it stood then, reading nothing later. At most 30 days ago and 5 minutes ahead. Defaults to now.",
          ),
        decision: decisionArg,
      },
      outputSchema: {
        verdict: z.string(),
        probabilities: z.record(z.number()),
        decision: z.unknown(),
        evidence: z.unknown(),
        asOf: z.number(),
        searchedFrom: z.number(),
        coverage: z.unknown(),
      },
      annotations: {
        title: "Verify",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) =>
      run(deps, () =>
        deps.v3.send(
          "POST",
          "/v3/verify",
          pickDefined({
            statement: args.statement,
            context: args.context,
            asOf: args.asOf,
            decision: args.decision,
          }),
        ),
      ),
  );
}
