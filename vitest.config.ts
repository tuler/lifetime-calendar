import { defineConfig } from "vitest/config";

// Kept separate from vite.config.ts so the unit tests don't boot the Workers
// runtime — they only exercise pure modules (ics, crypto).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
