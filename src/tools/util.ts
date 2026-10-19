import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Deps } from "../client.js";
import { describeError } from "../errors.js";
import { asArray, errorResult, toResult } from "../shape.js";
import type { Verbosity } from "../shape.js";

export const verbosityArg = z
  .enum(["concise", "detailed"])
  .default("concise")
  .describe(
    "concise returns the high signal fields only. Use detailed when you need every metric.",
  );

export const timeWindowArg = z
  .string()
  .optional()
  .describe('Relative window such as "1h", "24h" or "7d".');

export const fromArg = z
  .number()
  .int()
  .optional()
  .describe("Start of an absolute range, unix seconds. Use with to.");

export const toArg = z
  .number()
  .int()
  .optional()
  .describe("End of an absolute range, unix seconds. Use with from.");

export const pageArg = z
  .number()
  .int()
  .min(1)
  .default(1)
  .describe("Page number, starting at 1.");

export const pageSizeArg = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(10)
  .describe(
    "Items per page, up to 100. Keep it small and page through rather than asking for everything at once.",
  );

export const repostsArg = z
  .boolean()
  .optional()
  .describe("Include reposts in the results.");

export const eqlQueryArg = z
  .record(z.unknown())
  .describe(
    "EQL query object with conditions, actions and expiresIn. Build it with auto_build and check it with auto_validate first. Use notify or webhook actions: a query carrying a credential, such as a telegram_bot botToken or a webhook signingSecret, is refused.",
  );

export const v3FromArg = z
  .number()
  .int()
  .optional()
  .describe(
    "Start of the range, unix seconds, not milliseconds. Required unless you fetch by ids or search with q. api_status returns historyFrom, the earliest time your plan reads.",
  );

export const v3ToArg = z
  .number()
  .int()
  .optional()
  .describe("End of the range, unix seconds. Defaults to now.");

export const idsArg = z
  .array(z.string())
  .min(1)
  .max(30)
  .optional()
  .describe("Fetch up to 30 you already hold, by id. No from needed.");

export const entityIdsArg = z
  .array(z.string())
  .min(1)
  .max(30)
  .optional()
  .describe("Up to 30 ids from the entities tool. Matches any of them.");

export const orderArg = z
  .enum(["desc", "asc"])
  .optional()
  .describe("desc (default) or asc.");

export const cursorArg = z
  .string()
  .optional()
  .describe("nextCursor from the previous reply. Change any argument but limit and it fails; start again without it.");

export function limitArg(max: number) {
  return z
    .number()
    .int()
    .min(1)
    .max(max)
    .default(10)
    .describe(
      `Items per page, up to ${max}. Keep it small and page with cursor rather than asking for everything at once.`,
    );
}

export const pageOutput = {
  items: z.array(z.record(z.unknown())),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  servedFrom: z.number().nullable(),
};

export function page(
  response: Record<string, unknown>,
  key: string,
): z.infer<z.ZodObject<typeof pageOutput>> {
  return {
    items: asArray<Record<string, unknown>>(response[key]),
    nextCursor: typeof response.nextCursor === "string" ? response.nextCursor : null,
    hasMore: response.hasMore === true,
    servedFrom: typeof response.servedFrom === "number" ? response.servedFrom : null,
  };
}

const CREDENTIAL_FIELDS = new Set(["bottoken", "signingsecret"]);

export function credentialField(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = credentialField(item);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const [key, entry] of Object.entries(value)) {
    if (CREDENTIAL_FIELDS.has(key.toLowerCase())) return key;
    const found = credentialField(entry);
    if (found) return found;
  }
  return undefined;
}

export function rejectCredentials(query: unknown): CallToolResult | undefined {
  const field = credentialField(query);
  if (!field) return undefined;
  return errorResult(
    `The query carries a credential in ${field}. This server never accepts credentials as tool arguments, so telegram_bot actions and webhook signing secrets cannot be set here. Use a notify action, or a webhook without signingSecret, and set those up through the Elfa API directly.`,
  );
}

export function run(
  deps: Deps,
  fn: () => Promise<Record<string, unknown>>,
): Promise<CallToolResult> {
  return fn()
    .then((structured) => toResult(structured, deps.maxResponseChars))
    .catch((error: unknown) => errorResult(describeError(error)));
}

export function fail(message: string): CallToolResult {
  return errorResult(message);
}

export function asVerbosity(value: string | undefined): Verbosity {
  return value === "detailed" ? "detailed" : "concise";
}

export function stripHandle(username: string): string {
  return username.replace(/^@/, "").trim();
}

export function pickDefined<T extends Record<string, unknown>>(
  input: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
