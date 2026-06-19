import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve the project's "@/..." path alias (mirrors tsconfig.json) so tests can
// import app modules the same way the app does, including transitive imports.
const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": rootDir.replace(/\/$/, "") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // The AI extraction eval (Tier 3) hits the network/costs tokens — keep it out
    // of the fast unit loop; it gets its own opt-in script when we build it.
    exclude: ["tests/eval/**", "node_modules/**"],
  },
});
