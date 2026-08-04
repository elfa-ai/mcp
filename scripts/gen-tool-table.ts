import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface Manifest {
  tools: Array<{
    name: string;
    summary: string;
    credits: string;
    annotations: { readOnlyHint: boolean };
    operations: string[];
  }>;
  unexposed: Array<{ operationId: string; note: string }>;
}

const root = resolve(import.meta.dirname, "..");
const readmePath = resolve(root, "README.md");
const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

const manifest = JSON.parse(
  readFileSync(resolve(root, "manifest.json"), "utf8"),
) as Manifest;

const rows = manifest.tools.map((tool) => {
  const mode = tool.annotations.readOnlyHint ? "read" : "write";
  return `| \`${tool.name}\` | ${mode} | ${tool.credits} | ${tool.summary} |`;
});

const unexposed = manifest.unexposed.map(
  (entry) => `- \`${entry.operationId}\` — ${entry.note}`,
);

const table = [
  `${manifest.tools.length} tools, mapped to every documented \`/v2\` operation.`,
  "",
  "| Tool | Mode | Cost | What it does |",
  "| --- | --- | --- | --- |",
  ...rows,
  "",
  "Not exposed as tools:",
  "",
  ...unexposed,
].join("\n");

const readme = readFileSync(readmePath, "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);

if (start === -1 || end === -1) {
  console.error(`README.md is missing the ${START} and ${END} markers.`);
  process.exit(1);
}

const next = `${readme.slice(0, start + START.length)}\n\n${table}\n\n${readme.slice(end)}`;

if (process.argv.includes("--check")) {
  if (next !== readme) {
    console.error("README.md tool table is stale. Run npm run docs:tools.");
    process.exit(1);
  }
  console.log("README.md tool table is current.");
} else {
  writeFileSync(readmePath, next);
  console.log("README.md tool table updated.");
}
