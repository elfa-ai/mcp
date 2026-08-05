import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "build/mcpb/server",
  format: ["cjs"],
  target: "node20",
  noExternal: [/.*/],
  outExtension: () => ({ js: ".js" }),
  dts: false,
  clean: true,
  sourcemap: false,
  banner: { js: "#!/usr/bin/env node" },
});
