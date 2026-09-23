import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildDeps, CredentialError } from "./client.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { createServer } from "./server.js";
import { fetchEntitlements } from "./entitlements.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.transport === "http") {
    const app = createHttpApp(config);
    app.listen(config.port, config.host, () => {
      process.stderr.write(
        `elfa-mcp listening on http://${config.host}:${config.port}/mcp\n`,
      );
    });
    return;
  }

  const deps = buildDeps(config);
  // Read once: a stdio server runs as one key for its whole life.
  const server = createServer(deps, await fetchEntitlements(deps));
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message =
    error instanceof CredentialError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
