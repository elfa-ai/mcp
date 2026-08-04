const DOCS = "https://docs.elfa.ai";

interface StatusCarrier {
  statusCode?: number;
  status?: number;
  message?: string;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as StatusCarrier;
  return candidate.statusCode ?? candidate.status;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Unknown error";
}

export function missingCredential(what: "apiKey" | "hmacSecret"): string {
  if (what === "apiKey") {
    return `No Elfa API key configured. Set ELFA_API_KEY in the MCP server environment, or send it as an x-elfa-api-key header when using the HTTP transport. Get a key at ${DOCS}.`;
  }
  return `This action requires request signing. Set ELFA_HMAC_SECRET in the MCP server environment, then retry. Notification-only Auto queries work without it. See ${DOCS}/auto/api-key-auth.`;
}

export function describeError(error: unknown): string {
  const status = statusOf(error);
  const detail = messageOf(error);

  switch (status) {
    case 400:
      return `Request rejected as invalid: ${detail}. Check the argument values and retry.`;
    case 401:
      return `Authentication failed: ${detail}. Verify ELFA_API_KEY, and ELFA_HMAC_SECRET if this action requires signing.`;
    case 402:
      return `Out of credits: ${detail}. Top up or upgrade the plan, then retry.`;
    case 403:
      return `Not permitted on this key: ${detail}. The feature may need to be enabled for the key. See ${DOCS}.`;
    case 404:
      return `Not found: ${detail}. Confirm the id or username exists before retrying.`;
    case 409:
      return `Conflicting state: ${detail}. Re-read the current state and retry with values that match it.`;
    case 422:
      return `Validation failed: ${detail}. Fix the reported fields and retry.`;
    case 410:
      return `No longer available: ${detail}. The resource has finished its lifecycle, re-read the current state instead of retrying.`;
    case 429:
      return `Rate limited: ${detail}. Wait for any reset time named above, then retry with fewer, wider requests.`;
    default:
      break;
  }

  if (status !== undefined && status >= 500) {
    return `Elfa API error (${status}): ${detail}. This is server side, retry shortly.`;
  }

  return detail;
}
