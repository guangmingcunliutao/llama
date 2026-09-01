import path from "node:path";
import { fileURLToPath } from "node:url";
import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Node 内置模块不打进包，运行时由 Node 提供。 */
const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
];

/**
 * 把 CLI 与可编程入口打成 ESM，目标 Node 18。
 * 类型声明由随后的 `tsc --emitDeclarationOnly` 生成。
 */
export default defineConfig({
  build: {
    target: "node18",
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: {
        cli: path.resolve(root, "src/cli.ts"),
        index: path.resolve(root, "src/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [...nodeExternals, "xlsx", "jiti"],
      output: {
        // 让 dist/cli.js 可直接当命令执行（和 Vite 的 bin 一样带 shebang）
        banner: (chunk) => (chunk.name === "cli" ? "#!/usr/bin/env node" : ""),
      },
    },
  },
});
