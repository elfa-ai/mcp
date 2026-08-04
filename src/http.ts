import express from "express";
import type { NextFunction, Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildDeps, CredentialError } from "./client.js";
import type { ServerConfig } from "./config.js";
import { createServer } from "./server.js";

const MCP_PATH = "/mcp";

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function jsonRpcError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null,
  });
}

export function createHttpApp(config: ServerConfig): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));
  app.use(
    (
      error: Error & { status?: number },
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (error?.status === 400 || error instanceof SyntaxError) {
        jsonRpcError(res, 400, "Request body is not valid JSON.");
        return;
      }
      next(error);
    },
  );

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.post(MCP_PATH, async (req: Request, res: Response) => {
    const origin = header(req, "origin");
    if (
      origin &&
      config.allowedOrigins.length > 0 &&
      !config.allowedOrigins.includes(origin)
    ) {
      jsonRpcError(res, 403, "Origin not allowed.");
      return;
    }

    let server: McpServer | undefined;
    let transport: StreamableHTTPServerTransport | undefined;

    try {
      const deps = buildDeps(config, {
        apiKey: header(req, "x-elfa-api-key"),
        hmacSecret: header(req, "x-elfa-hmac-secret"),
      });

      server = createServer(deps);
      transport = new StreamableHTTPServerTransport({
        ...(config.allowedOrigins.length > 0
          ? { allowedOrigins: config.allowedOrigins, enableDnsRebindingProtection: true }
          : {}),
      });

      res.on("close", () => {
        void transport?.close();
        void server?.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (error instanceof CredentialError) {
        jsonRpcError(res, 401, error.message);
        return;
      }
      if (!res.headersSent) {
        jsonRpcError(res, 500, "Internal server error.");
      }
    }
  });

  app.get(MCP_PATH, (_req, res) => {
    jsonRpcError(res, 405, "Method not allowed. This server is stateless, use POST.");
  });

  app.delete(MCP_PATH, (_req, res) => {
    jsonRpcError(res, 405, "Method not allowed. This server is stateless, use POST.");
  });

  return app;
}
