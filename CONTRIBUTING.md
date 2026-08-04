# Contributing

```bash
npm install
npm run verify
```

`verify` runs typecheck, tests, the spec drift check and the docs check. CI runs the same thing.

## Adding API coverage

The Elfa API is the source of truth, mirrored here as `swagger.json`.

1. `npm run update:schema`
2. `npm run check:drift` — it fails and names any operation without a tool
3. Map each one in `manifest.json`, either onto a tool or into `unexposed` with a reason
4. Implement it in `src/tools/`
5. `npm run docs:tools` to regenerate the README table

## Conventions

- Keep the tool count low. Prefer a `method` or `mode` argument on an existing tool over a new one
- Every tool needs an `outputSchema` and all four annotations
- Errors should tell the model how to fix the call
- Never accept credentials as tool arguments
- No comments in source. Name things so they do not need one
