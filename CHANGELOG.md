# Changelog

## 4.9.0

### Changed

- **Auto queries can't carry credentials.** `auto_query_write` (create), `auto_draft` (upsert) and `auto_validate` refuse a query that contains a `botToken` or `signingSecret` field anywhere in it, before calling the API. The repository rule is that tools never accept credentials as arguments, and a `telegram_bot` action or a signed webhook could pass one through the free-form query object. Use `notify`, or a webhook without `signingSecret`; set up Telegram delivery and signed webhooks through the Elfa API directly.
- **`openWorldHint` is `true` on tools that read public data or reach open-ended destinations**: `mentions`, `trending`, `narratives`, `account_stats`, `market_chat`, `auto_build`, `auto_query_write`, `auto_draft`, `entities`, `events`, `market`, `calls` and `top_accounts`. `api_status`, `auto_query` and `auto_validate` stay `false`, since they only touch the caller's own account.
- Plan and credit messages explain what is unavailable instead of telling the user to upgrade or top up. Plan-gated tools now say plans are described at the pricing page.
- The server instructions and the `entities`, `events`, `market`, `calls` and `top_accounts` descriptions no longer say the v3 tools are free on Pay-as-you-go and Grow. Plan details belong on the pricing page, not in text the model reads.

### Added

- `ELFA_MCP_OPENAI_APPS_CHALLENGE` serves OpenAI's plugin domain-verification token as plain text at `/.well-known/openai-apps-challenge`. The route exists only when the variable is set.
- `plugins/elfa/` holds a draft plugin package for OpenAI's plugin directory: the manifest, the MCP connection to `https://mcp.elfa.ai/mcp` and a starter skill. It isn't submitted yet.

## 4.8.0

### Added

- **`auto_validate` returns `tweetAccounts`** (API 2.12.0): the X account behind each `tweet` condition and how it is billed. `included` accounts cost nothing extra; `per_post` accounts cost `creditsPerPost` for every post from the account (not replies or reposts), matched or not, while the query runs, on top of `estimatedCredits`. The `auto_validate` and `auto_query_write` descriptions tell agents to state that cost before activating.

### Changed

- **API v3 is free until 31 October 2026** on Pay-as-you-go and Grow (API 2.11.2). The v3 tool descriptions, server instructions and the bundle's tool list say so.
- `auto_query`: `method=get` mentions the `failure` a query carries when it failed with a recorded reason (API 2.12.0).
- `auto_build` says Builder Chat drafts `tweet` conditions only for accounts in Elfa's real-time set; for any other X account, write the condition yourself.
- Links point at the current docs.elfa.ai pages (`/tools/mcp`, `/tools/sdks`, `/api/v3/overview`) instead of their redirects.
- `swagger.json` is the published 3.0.0 spec.

### Removed

- `auto_validate` no longer returns `estimatedCost`. The API returns it only on x402, never to an API key, so it was always `null` here; `estimatedCredits` is the estimate.

## 4.7.0

### Added

- **`top_accounts` ranks by track record.** A new `metric` argument (API 2.11.0) takes `standing` (the default), `alphaScore`, `hitRate` or `avgReturn`. The track metrics rank only accounts with at least 20 scored positions, over every position since late June 2026. The description steers agents to `alphaScore` for "best callers", because `avgReturn` is not adjusted for the market.

### Changed

- `events`: the `assetClass` description now says it keeps events tied to that market by what they name, plus events tied to neither, and that a repeated query can return fewer as names get linked to assets (API 2.10.1). For `level=arcs` it keeps arcs where at least 15% of events name an asset in that market, then macro arcs.
- `cursor` descriptions state the published paging rule: change any argument but `limit` and the cursor fails.
- Server instructions drop the unix-seconds line, which every `from` argument already carries.
- `swagger.json` is the published 2.11.0 spec.

### Fixed

- `api_status` aborts its API v3 key-status lookup after 3 seconds, without retrying, instead of leaving the request open in the background.

## 4.6.0

### Added

- **API v3 tools.** Five tools read API v3 across crypto and equities, free on Pay-as-you-go and Grow plans and open to Enterprise keys:
  - `entities` resolves a ticker, $cashtag, name, @handle, contract address, CoinGecko id, FIGI or CIK to the entity id that `events` and `calls` filter on (`/v3/entities`).
  - `events` reads events, storylines and arcs, searchable by topic with `q` (`/v3/events`, `/v3/events/storylines`, `/v3/events/arcs`).
  - `market` reads mindshare, call books and trending contracts (`/v3/market/{crypto,equity}/mindshare`, `/v3/market/{crypto,equity}/call-book`, `/v3/market/crypto/trending-contracts`).
  - `calls` reads calls, call episodes and positioning (`/v3/calls`, `/v3/calls/episodes`, `/v3/calls/positioning`).
  - `top_accounts` ranks X accounts by standing (`/v3/people/accounts`).
- **`api_status` returns `historyFrom`** from `/v3/key-status`: the earliest time, in unix seconds, the events, market and calls tools read on the key's plan.
- A key without v3 access sees the v3 tools listed with the upgrade path, the same way as `market_chat`, and calling one spends nothing. Every v3 tool's reply carries the same untrusted-content notice as mentions and narratives: events are written up from posts, and the rest carry third-party asset, account and channel names.
- The README and installation guide cover the hosted server at `https://mcp.elfa.ai/mcp`.

### Changed

- `swagger.json` is the published 2.10.0 spec. `check:drift` covers `/v2` and `/v3`.
- `api_status` reports a failed `/v3/key-status` lookup in `problem` as `historyFrom unavailable: …`, and waits for it at most 3 seconds.
- When a reply is trimmed to fit and page items were dropped, the note says `nextCursor` continues after them, so re-read the page with a lower `limit` before paging on.

### Removed

- **`gmx` is no longer an `auto_validate` exchange.** The published spec dropped it from `/v2/auto/validate-symbol/{exchange}/{symbol}`, so `method=symbol` takes `hyperliquid` or `binance`.

## 4.5.0

### Added

- **`market_chat` returns its sources.** The reply now includes `sources`: the links the research behind the answer read (X posts, news, DEX and explorer pages, prediction markets), in the order it read them, each with a `url`, a `kind` and an optional `title` such as "Searched X". Links only, never the page or post text. A source was read, not necessarily cited in `message`, and the list is empty when the answer used no linkable source. The tool asks for them with `includeSources: true` on `POST /v2/chat` (API 2.8.1); it costs nothing extra. `kind` is a plain string, so treat a value you don't recognise as `web`.

## 4.4.0

### Added

- **Upstream requests carry an `elfa-mcp` User-Agent.** Every upstream call now carries `User-Agent: elfa-mcp/<version> (<transport>)`, where the transport is `stdio` or `http`, instead of the SDK's generic `@elfa-ai/sdk/<version>`. When the server knows which app is connected, it adds that too: on HTTP, the client's own `User-Agent`; on stdio, the `clientInfo` name and version from the MCP handshake, e.g. `elfa-mcp/4.4.0 (stdio; client=claude-ai/0.1.0)`. The client part is cut to printable ASCII and 100 characters, with `(`, `)`, `;` and `\` turned into spaces so the comment stays parseable. A `User-Agent` set in `ELFA_EXTRA_HEADERS`, in any casing, still wins.
- **The HTTP server logs each handshake.** One JSON line per successful `initialize` goes to stderr, `{"event":"initialize","client":{"name":…,"version":…}}`, so you can see which apps connect even when they never call a tool. Nothing else from the request is logged.

## 4.3.0

### Changed

- **Plan-gated tools say so up front.** The server reads the key's scopes from `/v2/key-status`: once at startup on stdio, and per request on HTTP, cached for a minute per key. When the plan doesn't include a tool (today only `market_chat`), the tool stays listed, but its description says it needs a higher-tier plan and links to pricing. Calling it returns the upgrade link at once, with no API call and no credits spent. Before, the agent found out only by spending a call on a permission error.
- If the scopes can't be read within 3 seconds, nothing is locked and the API still enforces access.

## 4.2.0

### Added

- **OAuth sign-in for hosted deployments** (`ELFA_MCP_AUTH=oauth`, HTTP transport only). Clients such as ChatGPT, Claude and Codex can connect with a browser sign-in instead of an API key. The server acts as an OAuth resource server under the MCP authorization spec:
  - It serves RFC 9728 protected-resource metadata at `/.well-known/oauth-protected-resource/mcp` (and at the root path).
  - A request with no credential gets `401` with a `WWW-Authenticate: Bearer resource_metadata=…` challenge.
  - Each bearer token is checked against the authorization server's introspection endpoint, which returns the Elfa API key the request runs as. The token itself is never forwarded to the Elfa API.
  - The token must be issued for this server: its audience has to match `ELFA_MCP_RESOURCE_URL`.
  - Valid answers are cached for up to 60 seconds.
  - An unreachable authorization server returns `503`, not `401`, so clients don't restart sign-in because of an outage.
- An `x-elfa-api-key` header still works in OAuth mode, so API-key users of the same deployment are unaffected.

### Changed

- `getMarketEvents-v2` is no longer listed as unexposed. The Elfa API dropped it from the published spec, so there is nothing left to account for.
- In OAuth mode `ELFA_API_KEY` is ignored. Every request brings its own credential, and an environment key would otherwise be handed to any caller that sends none. API-key mode keeps its environment fallback.

## 4.1.0

### Security

- **DNS rebinding protection is now armed by default on the HTTP transport.** `enableDnsRebindingProtection` was only passed when `ELFA_MCP_ALLOWED_ORIGINS` was set, and that variable is unset in the documented local run (`ELFA_MCP_TRANSPORT=http npx -y @elfa-ai/mcp`), so the control shipped present but disarmed. The transport accepted any `Host` and any `Origin` while holding `ELFA_API_KEY`, which let a page the user visits re-point its own hostname at `127.0.0.1` and reach `tools/list` and `tools/call` at that process's own privilege — including the `auto_*` tools that spend credits. Binding to `127.0.0.1` was never a mitigation, because the victim's browser is already on loopback.

  Setting the origin allowlist did not close it either. `allowedOrigins` was passed but `allowedHosts` never was, and the SDK guards each check with its own `length > 0` test, so `Host` validation never ran. An origin allowlist cannot carry this alone: a rebound request is same-origin and sends no `Origin` header, which leaves `Host` as the only header still naming the attacker's domain.

  Refs GHSA-w48q-cv73-mx4w / CVE-2025-66414. Reported by mcpdone.

### Added

- **`ELFA_MCP_ALLOWED_HOSTS`**, a comma separated `Host` allowlist. It defaults to the loopback names the server binds — `ELFA_MCP_HOST:PORT`, `localhost:PORT` and `127.0.0.1:PORT` — so the documented local run is closed with no configuration.

### Changed

- **Action required for hosted deployments.** The host allowlist fails closed, so a deployment answering on any `Host` other than the loopback names the server binds now returns `403` until it sets `ELFA_MCP_ALLOWED_HOSTS`. That covers a public domain, a reverse proxy, and a container that maps the port to a different one than the server binds, since the default is derived from `ELFA_MCP_PORT`.

  A minor rather than a major, because nothing about the interaction with this server changes: the eleven tools, their arguments, the stdio transport and every client-facing contract are untouched. A self-hosted HTTP deployment needs one environment variable.

  **Migration:** set `ELFA_MCP_ALLOWED_HOSTS` to the host values the deployment serves, for example `ELFA_MCP_ALLOWED_HOSTS=mcp.example.com`. The stdio transport is unaffected and needs no change.

## 4.0.0

### Removed

- **`ELFA_HMAC_SECRET` and request signing are gone.** Elfa no longer documents HMAC signing for `/v2/auto/*` — the API key alone authenticates every route, including mutations. Removed here: the `ELFA_HMAC_SECRET` environment variable, the `x-elfa-hmac-secret` request header on the HTTP transport, the `elfa_hmac_secret` field in the Claude Desktop bundle, and the registry entry in `server.json`.

  **Migration:** unset `ELFA_HMAC_SECRET` and stop sending `x-elfa-hmac-secret`. Neither is read any more. Nothing replaces them.

- **The client-side signing gate is gone.** `auto_query_write` and `auto_draft` no longer inspect a query's action shape and pre-reject it before sending. Every action type Elfa documents for API-key Auto — `notify`, `telegram_bot`, `webhook`, `llm` — is accepted with the API key alone, so the gate could only produce false rejections.

- **`hmacEnabled` is no longer reported by `api_status`.** The field was removed from the key-status response, so surfacing it would report something the API no longer sends.

- **`pacifica` is no longer a valid `auto_validate` exchange.** The documented enum for `method=symbol` is now `hyperliquid`, `gmx`, `binance`.

### Changed

- **Spec refreshed to `2.6.3`** from `2.5.0`. A credit is now $0.0145, so the x402 reference prices move to $0.0145 (1 credit), $0.0725 (5 credits) and $0.261 (18 credits). Accounts already on PAYG keep $0.009 per credit until 28 September 2026, 16:00 UTC.
- **`getMarketEvents-v2` is recorded as deliberately unexposed.** It is limited to select Enterprise customers and the published operation takes no parameters, so there is no usable tool surface. Eleven tools, unchanged.
- Install troubleshooting no longer claims a `403` on an Auto call means Auto is not enabled in the portal. There is no separate Auto enablement step; a new API key can call `/v2/auto/*` immediately.
- `SECURITY.md` now states that the API key is read from the environment on stdio and can arrive per request as `x-elfa-api-key` over HTTP, and refers to the tools by their current names.

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
