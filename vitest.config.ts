import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": srcDir },
  },
  test: {
    passWithNoTests: true,
    projects: [
      {
        resolve: { alias: { "@": srcDir } },
        test: {
          name: "core",
          environment: "node",
          setupFiles: ["fake-indexeddb/auto"],
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/ui/**", "node_modules/**"],
        },
      },
      {
        resolve: { alias: { "@": srcDir } },
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["tests/ui/**/*.test.tsx"],
        },
      },
    ],
  },
});
