import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildDeps, CredentialError } from "./client.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { createServer } from "./server.js";

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
  const server = createServer(deps);
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
