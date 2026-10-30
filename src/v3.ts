const DEFAULT_BASE_URL = "https://api.elfa.ai";
const RETRY_DELAY_MS = 1000;

export interface V3ClientOptions {
  apiKey: string;
  baseUrl?: string | undefined;
  timeout: number;
  retries: number;
  headers?: Record<string, string> | undefined;
}

export type V3Params = Record<string, string | number | boolean | string[] | undefined>;

export interface V3Client {
  get(path: string, params?: V3Params, limits?: { timeout?: number; retries?: number }): Promise<Record<string, unknown>>;
}

export class V3RedirectError extends Error {}

export class V3ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly details?: { code?: unknown } | null,
  ) {
    super(message);
  }
}

export function queryString(params: V3Params): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(","));
      continue;
    }
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function errorFrom(response: Response): Promise<V3ApiError> {
  let message = response.statusText || `HTTP ${response.status}`;
  const body = (await response.json().catch(() => null)) as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    requestId?: unknown;
  } | null;
  if (typeof body?.message === "string" && body.message) message = body.message;
  if (body?.details !== undefined && body?.details !== null) {
    message += ` ${JSON.stringify(body.details)}`;
  }
  const reset = response.headers.get("RateLimit-Reset");
  if (response.status === 429 && reset && body?.code !== "ERR_RATE_LIMITED") message += `. Resets in ${reset} seconds`;
  const requestId =
    typeof body?.requestId === "string" ? body.requestId : response.headers.get("x-request-id");
  if (requestId) message += ` (requestId ${requestId})`;
  return new V3ApiError(message, response.status, body);
}

function retryable(error: unknown): boolean {
  if (error instanceof V3RedirectError) return false;
  return !(error instanceof V3ApiError) || error.statusCode >= 500;
}

function causeOf(error: TypeError): string {
  const cause = error.cause as
    | { message?: unknown; code?: unknown; errors?: Array<{ message?: unknown }> }
    | undefined;
  const candidates = [cause?.message, cause?.code, cause?.errors?.[0]?.message];
  const found = candidates.find((value) => typeof value === "string" && value.length > 0);
  return typeof found === "string" ? found : "network error";
}

export function createV3Client(options: V3ClientOptions): V3Client {
  const base = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  async function request(url: string, timeout: number): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers: {
        ...options.headers,
        Accept: "application/json",
        "x-elfa-api-key": options.apiKey,
      },
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw await errorFrom(response);
    return (await response.json()) as Record<string, unknown>;
  }

  function once(url: string, timeout: number): Promise<Record<string, unknown>> {
    return request(url, timeout).catch((error: unknown) => {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new Error(`The Elfa API did not answer within ${timeout} ms. Retry, or narrow the request.`);
      }
      if (error instanceof TypeError && error.cause !== undefined) {
        const cause = causeOf(error);
        if (cause === "unexpected redirect") {
          throw new V3RedirectError(
            "The Elfa API answered with a redirect, which is refused so the API key is never forwarded. Check that ELFA_BASE_URL, if set, is the https API origin (default https://api.elfa.ai).",
          );
        }
        throw new Error(`Could not reach the Elfa API: ${cause}.`);
      }
      throw error;
    });
  }

  return {
    async get(path, params = {}, limits = {}) {
      const timeout = limits.timeout ?? options.timeout;
      const retries = limits.retries ?? options.retries;
      const url = `${base}${path}${queryString(params)}`;
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await once(url, timeout);
        } catch (error) {
          if (attempt >= retries || !retryable(error)) throw error;
          await new Promise((done) => setTimeout(done, RETRY_DELAY_MS * 2 ** attempt));
        }
      }
    },
  };
}
