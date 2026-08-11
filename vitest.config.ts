import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Convex関数のテストは convex-test + edge-runtime で実行する
export default defineConfig({
  resolve: {
    // tsconfig.json の paths["@/*"] と揃える(vite-tsconfig-paths 等のプラグインを
    // 追加せず、Next.js側と同じエイリアスをvitestにも手動で通す)。app/配下の
    // "@/lib/..." 形式のimportをテストから解決できるようにするため
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
