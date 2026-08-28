# Security

## Reporting

Open an [issue](https://github.com/elfa-ai/mcp/issues), or email [support@elfa.ai](mailto:support@elfa.ai) if you would rather not discuss it in public.

## Credentials

`ELFA_API_KEY` is issued by the developer portal. On stdio it is read from the environment; over HTTP it can also arrive per request as an `x-elfa-api-key` header, which takes precedence over the environment. It is never accepted as a tool argument, so it does not end up in model context or client transcripts. It is never logged.

Client config files that hold this value are plain text. Keep them out of version control.

## Untrusted content

Mentions, news and narratives are third-party social posts. Anyone can write them, including text designed to steer a model.

The server marks that content as untrusted in every response and instructs the model to treat it as data. That is a mitigation, not a guarantee. When an agent can reach both this content and a tool that spends money, review the chain.

## Actions that spend money

`auto_query_write` and `auto_draft` are annotated as write tools so clients prompt before running them. An activated Auto query fires its action unattended, without a further prompt.

## Remote deployments

The HTTP transport is stateless and holds no credentials between requests. When exposing it:

- terminate TLS in front of it
- set `ELFA_MCP_ALLOWED_HOSTS` to the domains it answers on
- set `ELFA_MCP_ALLOWED_ORIGINS`
- do not set `ELFA_API_KEY` on a multi-tenant deployment, require it per request instead

### DNS rebinding

The transport enables the SDK's DNS rebinding protection and defaults its host
allowlist to the loopback names it binds, so a local run is closed without
configuration. This matters most for a local run, not a hosted one: an
attacker's page can re-point its own hostname at `127.0.0.1` and the browser
then treats the server as same origin, reaching every tool at the privilege of
whatever key the process holds.

Binding to `127.0.0.1` is not a mitigation, because the victim's browser is
already on loopback. An origin allowlist is not one either, because the rebound
request is same origin and carries no `Origin` header. The `Host` header is the
control that works, which is why `ELFA_MCP_ALLOWED_HOSTS` must be set for any
deployment that answers on something other than the loopback names it binds.
