# Changelog

## 3.0.0

### Removed

- **The `auto_exchanges` tool is gone.** Exchange connections are no longer part of the documented Auto surface, so listing, connecting and disconnecting venues is no longer exposed here. The three operations are recorded in `manifest.json` under `unexposed`, so the drift check still accounts for every documented `/v2` operation. The endpoints remain reachable over the API for anyone who needs them.

### Changed

- **`validate_symbol` moved to `auto_validate`.** It is now `auto_validate` with `method=symbol`, taking `exchange` and `symbol`, and returns `valid: true/false` with the unsupported case reported as a validation error. The default `method=query` behaviour is unchanged.
- **Eleven tools**, down from twelve.
- Signing guidance everywhere — server instructions, `auto_query_write`, README, install docs, the desktop bundle and the registry entry — now describes `ELFA_HMAC_SECRET` as signing Auto mutations that are not plain notifications, rather than exchange linking and order placement.

## 2.0.0

### Changed

- **Tool names no longer carry an `elfa_` prefix.** Every major client already namespaces tools by server, so the prefix was duplicated: opencode showed `elfa_elfa_status`, Claude Code `mcp__elfa__elfa_status`. This matches what most first-party MCP servers do — Playwright registers `browser_*`, not `playwright_*`.

  | Before | After |
  | --- | --- |
  | `elfa_status` | `api_status` |
  | `elfa_mentions` | `mentions` |
  | `elfa_trending` | `trending` |
  | `elfa_narratives` | `narratives` |
  | `elfa_account_stats` | `account_stats` |
  | `elfa_chat` | `market_chat` |
  | `elfa_auto_build` | `auto_build` |
  | `elfa_auto_validate` | `auto_validate` |
  | `elfa_auto_query` | `auto_query` |
  | `elfa_auto_query_write` | `auto_query_write` |
  | `elfa_auto_draft` | `auto_draft` |
  | `elfa_auto_exchanges` | `auto_exchanges` |

  `status` and `chat` are qualified rather than left bare, because those are exactly the generic names that collide in clients which do not namespace.

  The old names are gone rather than aliased. Clients discover tools at startup, so nothing needs changing in normal use, but anything that pins a tool name — permission rules, hook matchers, allow-lists — needs updating.

- Tool descriptions that referred to sibling tools now use the new names.

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
