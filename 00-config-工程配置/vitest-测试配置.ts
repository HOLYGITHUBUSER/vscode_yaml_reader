import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "react/jsx-dev-runtime": "preact/jsx-dev-runtime",
      "react/jsx-runtime": "preact/jsx-runtime"
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./05-tests-测试/test-setup-测试初始化.ts"],
    include: [
      "05-tests-测试/unit-单元测试/*.test.ts",
      "05-tests-测试/unit-单元测试/*.test.tsx"
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage_覆盖率",
      include: [
        "02-core-核心能力/**/*.ts"
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80
      }
    }
  }
});
