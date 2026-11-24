# Elfa MCP

Model Context Protocol server for [Elfa](https://docs.elfa.ai). Get events, answers, verdicts and alerts from social and web data.

Elfa indexes social media and web pages, and turns them into high-intent events and entities. Your agent can query them, ask about them, or get an alert when they happen.

The tools cover [Data](https://docs.elfa.ai/enrich/overview), [Explain](https://docs.elfa.ai/explain/overview), [Verify](https://docs.elfa.ai/verify/overview), [Monitors](https://docs.elfa.ai/monitors/overview) and [Auto](https://docs.elfa.ai/auto/overview), plus the older [Social data (v2)](https://docs.elfa.ai/legacy/social-data) endpoints. Works with any MCP client, either signed in to the hosted server or running locally with an API key.

## Install

**Hosted, sign in with Elfa**

Add `https://mcp.elfa.ai/mcp` as a remote MCP server in your client and approve it in your browser with your [dev.elfa.ai](https://dev.elfa.ai) account. No key to copy, nothing to install. If your client cannot sign in, run the server locally instead. Setup steps are in the [MCP guide](https://docs.elfa.ai/integrations/mcp).

**Local, API key**

Get an API key at [dev.elfa.ai](https://dev.elfa.ai). No install step — `npx` fetches the server on demand.

**One click**

[![Add to Cursor](https://img.shields.io/badge/Add%20to-Cursor-000000?style=flat-square)](cursor://anysphere.cursor-deeplink/mcp/install?name=elfa&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBlbGZhLWFpL21jcCJdLCJlbnYiOnsiRUxGQV9BUElfS0VZIjoiJHtpbnB1dDplbGZhQXBpS2V5fSJ9fQ==)
[![Add to VS Code](https://img.shields.io/badge/Add%20to-VS%20Code-0098FF?style=flat-square)](https://vscode.dev/redirect/mcp/install?name=elfa&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40elfa-ai%2Fmcp%22%5D%2C%22env%22%3A%7B%22ELFA_API_KEY%22%3A%22%24%7Binput%3AelfaApiKey%7D%22%7D%7D)

**Claude Desktop**

Download `elfa-mcp-<version>.mcpb` from the [latest release](https://github.com/elfa-ai/mcp/releases/latest) and open it. Claude Desktop installs it, prompts for your API key, and keeps it updated. Nothing else to configure.

**Claude Code**

```bash
claude mcp add elfa --env ELFA_API_KEY=your-key -- npx -y @elfa-ai/mcp
```

**Cursor, VS Code, Claude Desktop, and other clients**

```json
{
  "mcpServers": {
    "elfa": {
      "command": "npx",
      "args": ["-y", "@elfa-ai/mcp"],
      "env": {
        "ELFA_API_KEY": "your-key"
      }
    }
  }
}
```

VS Code uses `"servers"` instead of `"mcpServers"`. Everything else is the same.

Ask *"Use Elfa's api_status tool and tell me my plan, my remaining requests and historyFrom."* to confirm it works. The tool is free.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `ELFA_API_KEY` | yes | Authenticates every request |
| `ELFA_TIMEOUT` | no | Request timeout in ms, default `120000` |
| `ELFA_RETRIES` | no | Retries on failure, default `0` |
| `ELFA_MCP_MAX_RESPONSE_CHARS` | no | Response size ceiling, default `60000` |
| `ELFA_EXTRA_HEADERS` | no | JSON object of extra headers to send upstream, for proxies and non-production environments |

Upstream requests identify themselves as `User-Agent: elfa-mcp/<version> (<transport>; client=<app>)`. On stdio, `<app>` is the MCP client's name and version from the handshake; over HTTP, it is the connecting client's own `User-Agent` header. Set `User-Agent` in `ELFA_EXTRA_HEADERS` to send your own instead.

The timeout is high and retries are off on purpose. `narratives` and `market_chat` are LLM-backed and can take over a minute, and they cost credits per attempt, so a silent retry would bill you again for a call you never saw. `ELFA_RETRIES` applies to the whole server, so raising it also retries `narratives`, and each retry is charged. `market_chat`, `verify` and `monitors_write` are never retried, whatever `ELFA_RETRIES` says.

Some MCP clients apply their own timeout, often around 60 seconds. `narratives` and `market_chat` can exceed that; the request still completes and is still charged, even if the client gives up first.

## Tools

<!-- tools:start -->

21 tools, mapped to every documented `/v2` and `/v3` operation.

| Tool | Mode | Cost | What it does |
| --- | --- | --- | --- |
| `api_status` | read | Free | Check API key tier, credit usage and remaining requests, and historyFrom, how far back events, market and calls read. Also confirms the API is reachable. |
| `entities` | read | 1 per call | Resolve a ticker, $cashtag, name, @handle, contract address, CoinGecko id, FIGI or CIK to the entity id that events and calls take. Matches exactly, it is not a search. |
| `events` | read | 1, plus 1 per event or 2 per storyline or arc | What is happening in crypto and equity markets. level=events for what happened and how prices reacted, level=storylines for one development threaded over days, level=arcs for storylines grouped into a larger movement. Searchable by topic. |
| `calendar` | read | 1, plus 1 per entry | What is scheduled across crypto, equities and macro: launches, unlocks, votes, listings, earnings, data releases, rate decisions and more, soonest first, with how reliable each date is. |
| `prediction_markets` | read | 1 per call | The open Polymarket and Kalshi markets that events, storylines or arcs bear on, and how their odds moved around the story. |
| `market` | read | call_book 2, mindshare 5, trending_contracts 5 (plus 5 over a 24 hour range), doubled for limit over 50 | Whole-market views for crypto or equities. view=mindshare ranks assets by share of attention, view=call_book is the crowd's long/short lean hour by hour, view=trending_contracts ranks contract addresses by how many posts pasted them. |
| `calls` | read | 1, plus 1 per call or 2 per episode; positioning 2 | Positions accounts take in posts. level=calls for each post that takes or changes a position, level=episodes for each position from open to close with the author's track record, level=positioning for open longs and shorts on one asset now. |
| `top_accounts` | read | 5 by standing, 25 by a track metric, doubled for limit over 50 | X accounts ranked by standing (how much other accounts engage with them) or, with metric, by their track record as callers (alphaScore, hitRate, avgReturn). |
| `verify` | read | 1 per call, whatever the verdict | Check whether one claim is true against recent X posts, public Telegram channels and web pages. Returns a verdict (supported, contradicted or notEnoughEvidence), its probabilities and links to the evidence, and can answer a yes/no, choice or score question from the same evidence. |
| `monitors` | read | Free | Read side of Monitors: list this key's monitors, read one, and page through a monitor's matches. |
| `monitors_write` | write | 2 per started hour while live; update and delete free | Create, update or delete a monitor, which watches new Elfa events and the web for something described in one sentence and sends each match to a signed webhook until deleted. |
| `auto_build` | read | 1 plus LLM usage | Turn a plain-language monitoring request into an EQL query. Returns a draft to validate and activate, it does not activate anything itself. |
| `auto_validate` | read | Free | Check EQL syntax and get a cost estimate before activating, or check that a symbol has market data on a venue. |
| `auto_query` | read | 1 for list, executions and execution; get, sessions and session free | Read side of Auto: list queries, poll one query, and read its executions and LLM sessions. |
| `auto_query_write` | write | 5 plus LLM usage to create, free to cancel or delete | Activate, cancel or delete an Auto query. Activated queries run unattended and fire their action when conditions are met. |
| `auto_draft` | read | 1 per call | Read side of Auto drafts: list saved drafts and read one. Drafts are queries parked without activating; they never evaluate or fire. |
| `auto_draft_write` | write | 1 to upsert or delete, convert costs the same as creating a query | Create, update, delete or activate an Auto draft. Converting a draft activates it as a live query that runs unattended. |
| `mentions` | read | 1 per call | Social mentions from X and Telegram. mode=top ranks a ticker's mentions by engagement, mode=search filters by keyword or account, mode=news returns the token news feed, which is X posts from accounts tagged as news sources rather than articles from news outlets. |
| `trending` | read | 1 per call | What is gaining social attention. scope=tokens for tickers, scope=contracts_twitter or scope=contracts_telegram for contract addresses. |
| `narratives` | read | 5 per call | Written narrative analysis with source links. scope=market extracts market-wide narratives, scope=keywords summarises events for specific keywords. |
| `market_chat` | read | Varies by speed | Ask for written market analysis. Supports conversational chat, macro overview, quick summary, token intro, token analysis and account analysis. |

Not exposed as tools:

- `chat-stream-v2` — A tool call returns one result, so streaming adds nothing. market_chat covers the same analysis.
- `auto-stream-queries-v2` — Long lived streams have no tool equivalent. Poll with auto_query.
- `auto-stream-query-v2` — Long lived streams have no tool equivalent. Poll with auto_query.
- `getAccountSmartStats-v2` — Deprecated and not maintained, so no tool wraps it. To rank accounts, use top_accounts; mentions with mode=search returns per-post engagement metrics with the posting account.

<!-- tools:end -->

Some tools depend on the plan: today `market_chat`, which needs a higher-tier plan than the free one, and the API v3 tools and `verify` on a key whose scopes leave them out. At startup (stdio) or per request (HTTP, cached for a minute per key), the server reads the key's scopes from `/v2/key-status`. A tool the plan doesn't include stays listed, but its description says it needs a higher-tier plan, and calling it returns the upgrade link without calling the API or spending credits. If the scopes can't be read within 3 seconds, every tool is listed as usual and the API decides.

`monitors` and `monitors_write` are never locked by the server. On a key without Monitors, the API refuses the call with `403`.

Streaming endpoints stay available through the [SDKs](https://docs.elfa.ai/integrations/overview#sdks) for applications that can consume SSE.

### Data, Verify and Monitors

`entities`, `events`, `calendar`, `prediction_markets`, `market`, `calls` and `top_accounts` read [Data](https://docs.elfa.ai/enrich/overview): events, storylines and arcs; scheduled dates; the prediction markets a story bears on; call books, mindshare and trending contracts; calls, call episodes and positioning; ranked accounts. They cover crypto and equities and are open to every plan. Each call costs credits, priced per endpoint on the [pricing page](https://docs.elfa.ai/platform/pricing#api-v3).

- Filters take entity ids, not tickers. Resolve an asset with `entities` first and reuse the id.
- Times are unix seconds. Milliseconds are refused.
- How far back a key reads depends on its plan. `api_status` returns it as `historyFrom`.

`verify` and the Monitors tools are open to every plan too.

- [`verify`](https://docs.elfa.ai/verify/overview) checks one claim against X posts and public Telegram channels from the last 7 days, and web pages, and returns `supported`, `contradicted` or `notEnoughEvidence` with links to the evidence. It costs 1 credit whatever the verdict; errors cost nothing.
- [Monitors](https://docs.elfa.ai/monitors/overview) watch new Elfa events and the open web for a query written in plain words, and POST each match to your https webhook, signed with [Standard Webhooks](https://www.standardwebhooks.com/). `monitors_write` creates, changes and deletes them; `monitors` lists them and reads back the last 30 days of matches. A live monitor costs 2 credits for each started hour until you delete it; every other Monitors call is free. A key holds 20 live monitors. Creating one returns `webhookSecret`, which verifies the signatures; `monitors` `method=get` returns it again.

### Where this differs from the raw API

The tools deliberately do not inherit every API default, because an agent pays for verbosity in context.

| | API | Here | Why |
| --- | --- | --- | --- |
| `pageSize` | 10 to 50 depending on endpoint, max 100 | 10 | Page through rather than pull everything |
| `limit` on v3 tools | 10, 20 or 50 depending on endpoint, max 30, 100 or 200 | 10 | Page with `cursor` rather than pull everything |
| `speed` on chat | `expert` | `fast` | Cheaper by default, ask for `expert` when depth matters |
| Mention fields | full record | high signal fields | Pass `verbosity: "detailed"` for the rest |
| Large responses | returned whole | trimmed to fit, with a note | Keeps one call from filling the context window |

Every value is still settable per call: `pageSize` accepts up to 100, and `limit` up to the endpoint's maximum.

## Auto

Auto queries run unattended. Once armed, a query keeps evaluating and fires its action without asking again.

The flow is three steps:

1. `auto_build` — describe what to watch in plain language, get EQL back
2. `auto_validate` — check the syntax and get the credit cost
3. `auto_query_write` — activate it

Actions can notify you, call a webhook, message a Telegram bot, or run an LLM analysis.

There is no push channel over MCP. Poll `auto_query` with `method=get`, and wait for the returned `pollAfterSeconds` between calls.

## Remote server

The same server runs over Streamable HTTP for hosted deployments:

```bash
ELFA_MCP_TRANSPORT=http ELFA_MCP_PORT=3000 npx -y @elfa-ai/mcp
```

It is stateless — no sessions, one server instance per request, safe behind a load balancer. Credentials come from the `x-elfa-api-key` request header, falling back to the environment, or from an OAuth sign-in (see below).

DNS rebinding protection is on by default. The server accepts only the loopback names it binds — `localhost:PORT` and `127.0.0.1:PORT` — which covers the local run above and nothing else. Any deployment that answers on a different `Host` must list the values it serves:

```bash
ELFA_MCP_ALLOWED_HOSTS=mcp.example.com
```

That includes a public domain, a reverse proxy, and a container that maps the port to a different one than the server binds. A `Host` the list does not cover is rejected with 403.

| Variable | Required | Purpose |
| --- | --- | --- |
| `ELFA_MCP_TRANSPORT` | no | `http` to serve over Streamable HTTP, default `stdio` |
| `ELFA_MCP_HOST` | no | Bind address, default `127.0.0.1` |
| `ELFA_MCP_PORT` | no | Bind port, default `3000` |
| `ELFA_MCP_ALLOWED_HOSTS` | no | Comma separated `Host` allowlist, defaults to the loopback names bound |
| `ELFA_MCP_ALLOWED_ORIGINS` | no | Comma separated `Origin` allowlist |
| `ELFA_MCP_OPENAI_APPS_CHALLENGE` | no | Domain-verification token from OpenAI's plugin portal, served as plain text at `/.well-known/openai-apps-challenge` |

Set `ELFA_MCP_ALLOWED_ORIGINS` as well when browsers call the server directly. It complements the host allowlist rather than replacing it: a rebound request is same origin, so it carries no `Origin` header for that list to check, and the `Host` header is the only one still naming the attacker's domain.

### OAuth sign-in

A hosted server can let clients sign in through a browser instead of sending an API key. Set `ELFA_MCP_AUTH=oauth` and the server becomes an OAuth resource server under the MCP authorization spec:

1. A request with no credential gets `401` and a `WWW-Authenticate` challenge.
2. The challenge points the client to the protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`.
3. That metadata names the authorization server, where the user signs in.
4. The client then sends `Authorization: Bearer <token>`.
5. The server checks the token against the authorization server's introspection endpoint, at most a minute apart.
6. It swaps the token for a short-lived token addressed to the Elfa API (RFC 8693 token exchange, at the `token-exchange` endpoint next to introspection) and calls the API with that, so the client's token never reaches the Elfa API. If the exchange is unavailable and introspection returned an API key, it calls with the key instead.

```bash
ELFA_MCP_TRANSPORT=http \
ELFA_MCP_AUTH=oauth \
ELFA_MCP_RESOURCE_URL=https://mcp.example.com/mcp \
ELFA_OAUTH_ISSUER=https://auth.example.com \
ELFA_OAUTH_INTROSPECTION_URL=https://auth.example.com/introspect \
ELFA_OAUTH_INTROSPECTION_TOKEN=... \
ELFA_MCP_ALLOWED_HOSTS=mcp.example.com \
npx -y @elfa-ai/mcp
```

| Variable | Required in OAuth mode | Purpose |
| --- | --- | --- |
| `ELFA_MCP_AUTH` | yes | `oauth` to enable, default `apikey` |
| `ELFA_MCP_RESOURCE_URL` | yes | Canonical URL of this endpoint. Tokens must be issued for exactly this value |
| `ELFA_OAUTH_ISSUER` | yes | Authorization server listed in the metadata |
| `ELFA_OAUTH_INTROSPECTION_URL` | yes | Where tokens are checked. The token exchange is the same URL with `/introspect` replaced by `/token-exchange` |
| `ELFA_OAUTH_INTROSPECTION_TOKEN` | yes | Bearer sent to the introspection and token exchange endpoints |
| `ELFA_OAUTH_SCOPES` | no | Comma separated scopes to advertise, default `elfa` |

Notes:

- An `x-elfa-api-key` header still works in OAuth mode.
- `ELFA_API_KEY` is ignored in OAuth mode, so a caller with no credential never runs as the server's own key.
- Valid tokens are cached for up to a minute, which bounds how long a revoked token keeps working.

## Safety

`api_status` is the fastest way to tell an auth problem from a credit problem.


Mentions, news and narratives return third-party social text that anyone can write, events are written up from it, and the v3 tools carry third-party asset, account and channel names. The server marks it as untrusted in every response, and the server instructions tell the model to treat it as data. Keep that in mind before letting an agent chain from that content into `auto_query_write`.

## Development

```bash
npm install
npm run build
npm run verify
```

`npm run verify` runs typecheck, tests, the spec drift check, and the docs check.

`manifest.json` maps every documented API operation to the tool that covers it. `npm run check:drift` fails if the API grows an operation the server does not handle. The tool table above is generated from the same file with `npm run docs:tools`.

## Links

- [Documentation](https://docs.elfa.ai)
- [API keys](https://dev.elfa.ai)
- [TypeScript SDK](https://www.npmjs.com/package/@elfa-ai/sdk)

## License

MIT
