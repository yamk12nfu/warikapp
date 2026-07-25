import { defineConfig } from "vitest/config";

// Convex関数のテストは convex-test + edge-runtime で実行する
export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
