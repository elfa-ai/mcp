import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Manifest {
  server: { specScope: string; version: string };
  tools: Array<{ name: string; operations: string[] }>;
  unexposed: Array<{ operationId: string; reason: string }>;
}

interface Swagger {
  paths: Record<string, Record<string, { operationId?: string }>>;
}

const root = resolve(import.meta.dirname, "..");

function load<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(root, file), "utf8")) as T;
}

const manifest = load<Manifest>("manifest.json");
const swagger = load<Swagger>("swagger.json");
const pkg = load<{ version: string }>("package.json");
const registry = load<{ version: string; packages: Array<{ version: string }> }>(
  "server.json",
);
const plugin = load<{ version: string }>(".cursor-plugin/plugin.json");
const scope = manifest.server.specScope;

const versions = new Set([
  pkg.version,
  manifest.server.version,
  registry.version,
  ...registry.packages.map((entry) => entry.version),
  plugin.version,
]);

const spec = new Set<string>();
for (const [path, methods] of Object.entries(swagger.paths)) {
  if (!path.startsWith(scope)) continue;
  for (const operation of Object.values(methods)) {
    if (operation.operationId) spec.add(operation.operationId);
  }
}

const mapped = new Map<string, string>();
const duplicates: string[] = [];

for (const tool of manifest.tools) {
  for (const operation of tool.operations) {
    if (mapped.has(operation)) {
      duplicates.push(`${operation} claimed by ${mapped.get(operation)} and ${tool.name}`);
    }
    mapped.set(operation, tool.name);
  }
}

for (const entry of manifest.unexposed) {
  if (mapped.has(entry.operationId)) {
    duplicates.push(`${entry.operationId} is both exposed and unexposed`);
  }
  mapped.set(entry.operationId, "unexposed");
}

const missing = [...spec].filter((operation) => !mapped.has(operation)).sort();
const unknown = [...mapped.keys()].filter((operation) => !spec.has(operation)).sort();

const problems: string[] = [];

if (missing.length > 0) {
  problems.push(
    `Documented operations absent from manifest.json:\n  ${missing.join("\n  ")}`,
  );
}

if (unknown.length > 0) {
  problems.push(
    `manifest.json references operations that are not in the spec:\n  ${unknown.join("\n  ")}`,
  );
}

if (duplicates.length > 0) {
  problems.push(`Ambiguous mappings:\n  ${duplicates.join("\n  ")}`);
}

if (versions.size > 1) {
  problems.push(
    `Version mismatch across package.json, manifest.json, server.json and .cursor-plugin/plugin.json: ${[...versions].join(", ")}`,
  );
}

if (problems.length > 0) {
  console.error(problems.join("\n\n"));
  console.error(
    "\nEvery documented operation must map to a tool in manifest.json, or sit in unexposed with a reason.",
  );
  process.exit(1);
}

console.log(
  `manifest.json covers ${spec.size} documented operations across ${manifest.tools.length} tools, ${manifest.unexposed.length} deliberately unexposed.`,
);
