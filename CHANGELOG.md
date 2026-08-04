# Changelog

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
