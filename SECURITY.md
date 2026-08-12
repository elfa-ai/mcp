# Security

## Reporting

Open an [issue](https://github.com/elfa-ai/mcp/issues), or email [support@elfa.ai](mailto:support@elfa.ai) if you would rather not discuss it in public.

## Credentials

Both values are issued by the developer portal. The HMAC secret is shown once and can be rotated; rotating it breaks any client still signing with the old one.

`ELFA_API_KEY` and `ELFA_HMAC_SECRET` are read from the environment only. They are never accepted as tool arguments, so they do not end up in model context or client transcripts. Neither value is logged.

Client config files that hold these values are plain text. Keep them out of version control.

## Untrusted content

Mentions, news and narratives are third-party social posts. Anyone can write them, including text designed to steer a model.

The server marks that content as untrusted in every response and instructs the model to treat it as data. That is a mitigation, not a guarantee. When an agent can reach both this content and a tool that spends money, review the chain.

## Actions that spend money

`elfa_auto_query_write` and `elfa_auto_draft` are annotated as write tools so clients prompt before running them. An activated Auto query fires its action unattended, without a further prompt.

Auto mutations that are not plain notifications require `ELFA_HMAC_SECRET`. Leaving it unset removes that capability entirely and is the right default for anything untrusted or shared.

## Remote deployments

The HTTP transport is stateless and holds no credentials between requests. When exposing it:

- terminate TLS in front of it
- set `ELFA_MCP_ALLOWED_ORIGINS`
- do not set `ELFA_API_KEY` or `ELFA_HMAC_SECRET` on a multi-tenant deployment, require them per request instead
