# Elfa MCP

Model Context Protocol server for the [Elfa API](https://docs.elfa.ai) — crypto social intelligence from X and Telegram, plus **Auto**, a condition engine that watches the market and fires an action when your conditions are met.

Works with any MCP client: Claude Code, Claude Desktop, Cursor, VS Code, Codex, and anything else that speaks MCP.

## Install

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

Ask *"what's trending in crypto right now?"* to confirm it works.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `ELFA_API_KEY` | yes | Authenticates every request |
| `ELFA_HMAC_SECRET` | no | Signs Auto requests. Needed only to connect an exchange, or to run a query whose action places an order |
| `ELFA_TIMEOUT` | no | Request timeout in ms, default `120000` |
| `ELFA_RETRIES` | no | Retries on failure, default `0` |
| `ELFA_MCP_MAX_RESPONSE_CHARS` | no | Response size ceiling, default `60000` |

The timeout is high and retries are off on purpose. The interpretation endpoints are LLM-backed and can take over a minute, and they cost credits per attempt, so a silent retry would bill you again for a call you never saw. Raise `ELFA_RETRIES` only if you are calling the cheap measurement endpoints.

Some MCP clients apply their own timeout, often around 60 seconds. `narratives` and `market_chat` can exceed that; the request still completes and is still charged, even if the client gives up first.

Without `ELFA_HMAC_SECRET` everything still works except exchange linking and order-placing queries — those return a message telling you what to set.

## Tools

<!-- tools:start -->

12 tools, mapped to every documented `/v2` operation.

| Tool | Mode | Cost | What it does |
| --- | --- | --- | --- |
| `api_status` | read | Free | Check API key tier, credit usage and remaining requests. Also confirms the API is reachable. |
| `mentions` | read | 1 per call | Social mentions from X and Telegram. mode=top ranks a ticker's mentions by engagement, mode=search filters by keyword or account, mode=news returns the token news feed. |
| `trending` | read | 1 per call | What is gaining social attention. scope=tokens for tickers, scope=contracts_twitter or scope=contracts_telegram for contract addresses. |
| `narratives` | read | 5 per call | Written narrative analysis with source links. scope=market extracts market-wide narratives, scope=keywords summarises events for specific keywords. |
| `account_stats` | read | 1 per call | Smart follower and engagement stats for an X account. |
| `market_chat` | read | Varies by speed | Ask for written market analysis. Supports conversational chat, macro overview, quick summary, token intro, token analysis and account analysis. |
| `auto_build` | read | 1 plus LLM usage | Turn a plain-language monitoring request into an EQL query. Returns a draft to validate and activate, it does not activate anything itself. |
| `auto_validate` | read | Free | Check EQL syntax and get a cost estimate before activating. Accepts an inline query or a draft id. |
| `auto_query` | read | Free | Read side of Auto: list queries, poll one query, and read its executions and LLM sessions. |
| `auto_query_write` | write | 5 plus LLM usage to create, free to cancel or delete | Activate, cancel or delete an Auto query. Activated queries run unattended and fire their action when conditions are met. |
| `auto_draft` | write | Free, except convert which costs the same as creating a query | Manage inactive Auto drafts. Drafts do not evaluate until converted into an active query. |
| `auto_exchanges` | write | Free | List, connect and disconnect the exchange accounts Auto uses for order actions, and check whether a symbol is tradeable. |

Not exposed as tools:

- `chat-stream-v2` — A tool call returns one result, so streaming adds nothing. market_chat covers the same analysis.
- `auto-stream-queries-v2` — Long lived streams have no tool equivalent. Poll with auto_query.
- `auto-stream-query-v2` — Long lived streams have no tool equivalent. Poll with auto_query.

<!-- tools:end -->

Streaming endpoints stay available through the [SDKs](https://docs.elfa.ai) for applications that can consume SSE.

### Where this differs from the raw API

The tools deliberately do not inherit every API default, because an agent pays for verbosity in context.

| | API | Here | Why |
| --- | --- | --- | --- |
| `pageSize` | 10 to 50 depending on endpoint, max 100 | 10 | Page through rather than pull everything |
| `speed` on chat | `expert` | `fast` | Cheaper by default, ask for `expert` when depth matters |
| Mention fields | full record | high signal fields | Pass `verbosity: "detailed"` for the rest |
| Large responses | returned whole | trimmed to fit, with a note | Keeps one call from filling the context window |

Every value is still settable per call, and `pageSize` accepts up to 100.

## Auto

Auto queries run unattended. Once armed, a query keeps evaluating and fires its action without asking again.

The flow is three steps:

1. `auto_build` — describe what to watch in plain language, get EQL back
2. `auto_validate` — check the syntax and get the credit cost
3. `auto_query_write` — activate it

Actions can notify you, call a webhook, message a Telegram bot, run an LLM analysis, or place an order on a connected exchange. Order actions need `ELFA_HMAC_SECRET` and a connected exchange.

### Connecting an exchange

| Venue | Connect from here | Credentials |
| --- | --- | --- |
| `binance` | yes | `apiKey`, `secret` |
| `pacifica` | yes | `privateKey`, `walletAddress` |
| `hyperliquid` | no, wallet is set up in the Elfa app | none |
| `gmx` | no, wallet is set up in the Elfa app | none |

Credentials are verified on connect, so a wrong value fails there rather than when an order fires. They are ordinary tool arguments, so they pass through the model and land in the client's transcript.

There is no push channel over MCP. Poll `auto_query` with `method=get`, and wait for the returned `pollAfterSeconds` between calls.

## Remote server

The same server runs over Streamable HTTP for hosted deployments:

```bash
ELFA_MCP_TRANSPORT=http ELFA_MCP_PORT=3000 npx -y @elfa-ai/mcp
```

It is stateless — no sessions, one server instance per request, safe behind a load balancer. Credentials come from `x-elfa-api-key` and `x-elfa-hmac-secret` request headers, falling back to the environment. Set `ELFA_MCP_ALLOWED_ORIGINS` to a comma separated allowlist when exposing it publicly.

## Safety

`api_status` is the fastest way to tell an auth problem from a credit problem.


Mentions, news and narratives return third-party social text that anyone can write. The server marks it as untrusted in every response, and the server instructions tell the model to treat it as data. Keep that in mind before letting an agent chain from that content into `auto_query_write` or `auto_exchanges`.

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
