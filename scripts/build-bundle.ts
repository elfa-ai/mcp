import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Manifest {
  tools: Array<{ name: string; summary: string }>;
}

interface Pkg {
  name: string;
  version: string;
  description: string;
  license: string;
  keywords: string[];
  repository: { url: string };
  bugs: { url: string };
  homepage: string;
  engines: { node: string };
}

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, "build/mcpb");

function load<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(root, file), "utf8")) as T;
}

const pkg = load<Pkg>("package.json");
const manifest = load<Manifest>("manifest.json");

execFileSync("npx", ["tsup", "--config", "tsup.bundle.config.ts"], {
  cwd: root,
  stdio: "inherit",
});

mkdirSync(out, { recursive: true });

const bundle = {
  $schema:
    "https://raw.githubusercontent.com/modelcontextprotocol/mcpb/main/schemas/mcpb-manifest-v0.4.schema.json",
  manifest_version: "0.4",
  name: "elfa",
  display_name: "Elfa",
  version: pkg.version,
  description: pkg.description,
  long_description:
    "Crypto social intelligence from X and Telegram, plus Auto, a condition engine that watches the market and fires an action when your conditions are met.",
  author: { name: "Elfa AI", url: "https://elfa.ai" },
  repository: { type: "git", url: pkg.repository.url.replace(/^git\+/, "") },
  homepage: pkg.homepage,
  documentation: pkg.homepage,
  support: pkg.bugs.url,
  license: pkg.license,
  keywords: pkg.keywords,
  icon: "icon.png",
  privacy_policies: ["https://www.elfa.ai/privacy"],
  server: {
    type: "node",
    entry_point: "server/index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/server/index.js"],
      env: {
        ELFA_API_KEY: "${user_config.elfa_api_key}",
        ELFA_HMAC_SECRET: "${user_config.elfa_hmac_secret}",
      },
    },
  },
  tools: manifest.tools.map((tool) => ({
    name: tool.name,
    description: tool.summary,
  })),
  tools_generated: false,
  user_config: {
    elfa_api_key: {
      type: "string",
      title: "API key",
      description: "Your Elfa API key from dev.elfa.ai",
      sensitive: true,
      required: true,
    },
    elfa_hmac_secret: {
      type: "string",
      title: "Signing secret",
      description:
        "Optional. Signs Auto mutations that are not plain notifications.",
      sensitive: true,
      required: false,
    },
  },
  compatibility: {
    claude_desktop: ">=0.10.0",
    platforms: ["darwin", "win32", "linux"],
    runtimes: { node: pkg.engines.node },
  },
};

writeFileSync(
  resolve(out, "manifest.json"),
  JSON.stringify(bundle, null, 2) + "\n",
);

writeFileSync(
  resolve(out, "server/package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);

for (const file of ["README.md", "LICENSE"]) {
  copyFileSync(resolve(root, file), resolve(out, file));
}

copyFileSync(resolve(root, "assets/icon.png"), resolve(out, "icon.png"));

execFileSync("npx", ["mcpb", "validate", resolve(out, "manifest.json")], {
  cwd: root,
  stdio: "inherit",
});

execFileSync(
  "npx",
  ["mcpb", "pack", out, resolve(root, `build/elfa-mcp-${pkg.version}.mcpb`)],
  { cwd: root, stdio: "inherit" },
);
