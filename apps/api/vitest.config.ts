import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use forked processes instead of threads so each test file gets its own
    // process.env — prevents NETWORKCHUM_DATA_DIR from leaking between files.
    pool: "forks",
  },
});
