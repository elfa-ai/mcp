import { createHash } from "node:crypto";
import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "./client.js";
import { fail } from "./tools/util.js";

/**
 * Plan-gated tools. A key whose plan lacks a tool's scope still sees the tool,
 * but its description says it needs a higher-tier plan and a call answers with
 * the upgrade path instead of reaching the API. That tells the agent (and the
 * user) before a call is spent, and points at the upgrade rather than hiding
 * the capability. Plan names are left out on purpose: the lineup changes, and
 * the pricing page is the source of truth.
 *
 * Only self-serve plan upgrades belong here. Scopes granted per key by sales
 * (enterprise endpoints, v3) have no upgrade to point at.
 */
export interface ToolGate {
  /** The oracle route scope the tool needs, as `/v2/key-status` lists it. */
  scope: string;
}

export const TOOL_GATES: Readonly<Record<string, ToolGate>> = {
  market_chat: { scope: "chat" },
};

export const UPGRADE_URL = "https://www.elfa.ai/pricing";

const LOOKUP_TIMEOUT_MS = 3_000;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 10_000;

export interface Entitlements {
  scopes: string[];
}

/** Same matching as oracle's `hasScope`: exact, `*`, or a `prefix/*` family. */
export function hasScope(scopes: string[], required: string): boolean {
  return scopes.some((scope) => {
    if (scope === "*") return true;
    if (scope.endsWith("/*")) return required.startsWith(`${scope.slice(0, -2)}/`);
    return scope === required;
  });
}

export function lockedMessage(tool: string): string {
  return `${tool} requires a higher-tier plan than this API key has. Upgrade at ${UPGRADE_URL}, then retry.`;
}

/**
 * The key's scopes, or undefined when they cannot be read in time. Undefined
 * leaves every tool unlocked: the API still refuses a call the key may not
 * make, so failing open costs one wasted call, never access.
 */
export async function fetchEntitlements(deps: Deps): Promise<Entitlements | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    const status = await Promise.race([
      deps.sdk.getApiKeyStatus(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), LOOKUP_TIMEOUT_MS);
      }),
    ]);
    const scopes = (status?.data as { scopes?: unknown } | undefined)?.scopes;
    if (!Array.isArray(scopes) || !scopes.every((s) => typeof s === "string")) {
      return undefined;
    }
    return { scopes };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Per-key cache for the HTTP transport, which builds a server per request.
 * Only answers are cached; a failed lookup is retried on the next request.
 */
export class EntitlementCache {
  private readonly cache = new Map<string, { value: Entitlements; expiresAtMs: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  async get(
    apiKey: string,
    load: () => Promise<Entitlements | undefined>,
  ): Promise<Entitlements | undefined> {
    const key = createHash("sha256").update(apiKey).digest("hex");
    const hit = this.cache.get(key);
    if (hit && hit.expiresAtMs > this.now()) return hit.value;
    if (hit) this.cache.delete(key);

    const value = await load();
    if (!value) return undefined;
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { value, expiresAtMs: this.now() + CACHE_TTL_MS });
    return value;
  }
}

/** Locks each gated tool the key's scopes do not cover. */
export function applyToolGates(
  tools: Readonly<Record<string, RegisteredTool>>,
  entitlements: Entitlements | undefined,
): void {
  if (!entitlements) return;
  for (const [name, gate] of Object.entries(TOOL_GATES)) {
    const tool = tools[name];
    if (!tool || hasScope(entitlements.scopes, gate.scope)) continue;
    const message = lockedMessage(name);
    tool.update({
      description: `Requires a higher-tier plan than this API key has (upgrade at ${UPGRADE_URL}). ${tool.description ?? ""}`.trim(),
      callback: async () => fail(message),
    });
  }
}
