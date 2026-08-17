# Installation

## Requirements

- Node.js 20 or newer
- An Elfa API key from [dev.elfa.ai](https://dev.elfa.ai)

There is nothing to install ahead of time. `npx` fetches the server the first time a client starts it.

## Claude Code

```bash
claude mcp add elfa --env ELFA_API_KEY=your-key -- npx -y @elfa-ai/mcp
```

## Claude Desktop

Edit the config file:

- macOS `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop afterwards.

## Cursor

`~/.cursor/mcp.json` for every project, or `.cursor/mcp.json` for one. Same JSON as Claude Desktop.

## VS Code

`.vscode/mcp.json` in the workspace, or the user config via `MCP: Open User Configuration`. VS Code uses `servers` rather than `mcpServers`:

```json
{
  "servers": {
    "elfa": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@elfa-ai/mcp"],
      "env": {
        "ELFA_API_KEY": "your-key"
      }
    }
  }
}
```

## Codex

```bash
codex mcp add elfa -- npx -y @elfa-ai/mcp
```

Set `ELFA_API_KEY` in the environment Codex runs in.

## Auto request signing

Some Auto mutations must be signed. That path needs `ELFA_HMAC_SECRET`, issued alongside the API key.

Notification-only queries — `notify`, `webhook`, `telegram_bot`, and `llm` with a notification callback — work with just the API key.

## Remote server

For a hosted deployment, run the same package over Streamable HTTP:

```bash
ELFA_MCP_TRANSPORT=http \
ELFA_MCP_PORT=3000 \
ELFA_MCP_ALLOWED_ORIGINS=https://your-client.example \
npx -y @elfa-ai/mcp
```

The endpoint is `POST /mcp`. It is stateless, so it scales horizontally without sticky sessions. Clients send `x-elfa-api-key`, and `x-elfa-hmac-secret` when an Auto mutation is not a plain notification. `GET /healthz` is a liveness probe.

Put it behind TLS and set `ELFA_MCP_ALLOWED_ORIGINS` before exposing it.

## Verifying

Ask the client *"what's trending in crypto right now?"*. It should call `trending`.

If a call fails, `api_status` reports whether the key is valid and how many credits remain.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Server does not appear | Node is older than 20, or the client was not restarted |
| Authentication failed | `ELFA_API_KEY` is missing, wrong, or expired |
| Out of credits | The plan's monthly credits are used up |
| Action requires request signing | `ELFA_HMAC_SECRET` is not set, and the mutation is not a plain notification |
| Forbidden on an Auto call | Auto has not been enabled for the account in the developer portal |
| Timestamp too far from server time | The machine's clock has drifted. Signed requests are rejected beyond 30 seconds |

Claude Desktop logs are in `~/Library/Logs/Claude/mcp*.log` on macOS and `%APPDATA%\Claude\logs\mcp*.log` on Windows.
