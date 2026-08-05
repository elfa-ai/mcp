# Changelog

## 1.0.2

Fixes found by running every tool against a live API.

- `elfa_status` returned the raw key-status payload, which includes the API key itself, the account email and internal identifiers. It now reports only tier, limits, usage, scopes and expiry, and surfaces the reason when the key lookup fails
- Default timeout raised to 120s. The LLM-backed endpoints regularly take longer than 30s, so they timed out before returning
- Retries now default to 0. A timed-out request to a credit-charging endpoint was retried three times and billed each time, so a failed call could cost four times its price
- `elfa_narratives` reports how many mentions matched, and says so when the summariser returns nothing, instead of an unexplained empty list

## 1.0.1

First release of the TypeScript server, published as `@elfa-ai/mcp`.

- 12 tools covering the documented `/v2` surface: mentions, trending tokens and contract addresses, narratives, account stats, market chat, and the Auto condition engine including drafts, executions, LLM sessions and exchange connections
- Runs over stdio or Streamable HTTP from one codebase, stateless so it scales horizontally
- Structured output with schemas, and tool annotations so clients know which tools write
- Response shaping: verbosity control, small page defaults, size ceilings, and field pruning
- Errors written for the model to recover from rather than raw status codes
- HMAC request signing for Auto trading actions and exchange linking
- `manifest.json` maps every documented API operation to its tool, enforced in CI

Streaming endpoints are not exposed as tools, since a tool call returns a single result. Poll `elfa_auto_query` instead, or use an SDK for SSE.
