import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Deps } from "../client.js";
import { describeError } from "../errors.js";
import { errorResult, toResult } from "../shape.js";
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
    "EQL query object with conditions, actions and expiresIn. Build it with elfa_auto_build and check it with elfa_auto_validate first.",
  );

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

const NOTIFICATION_ACTIONS = new Set(["notify", "telegram_bot", "webhook"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotificationAction(action: unknown): boolean {
  if (!isRecord(action)) return false;
  if (typeof action.type !== "string") return false;
  if (NOTIFICATION_ACTIONS.has(action.type)) return true;

  if (action.type === "llm") {
    if (!isRecord(action.params)) return false;
    if (!isRecord(action.params.callback)) return false;
    const callbackAction = action.params.callback.action;
    if (!isRecord(callbackAction)) return false;
    return (
      typeof callbackAction.type === "string" &&
      NOTIFICATION_ACTIONS.has(callbackAction.type)
    );
  }

  return false;
}

export function requiresSignature(query: unknown): boolean {
  if (!isRecord(query)) return true;
  const actions = query.actions;
  if (!Array.isArray(actions) || actions.length === 0) return true;
  return !actions.every(isNotificationAction);
}
