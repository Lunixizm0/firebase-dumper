import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/bin/**"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        statements: 75,
        branches: 60,
        functions: 80,
        lines: 75
      }
    }
  }
});
