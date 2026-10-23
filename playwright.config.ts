import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  timeout: 45000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:9051",
    channel: "chrome",
    headless: true,
    viewport: { width: 1280, height: 950 },
  },
  webServer: {
    command:
      "bun node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 9051 --strictPort",
    url: "http://127.0.0.1:9051",
    reuseExistingServer: false,
  },
  reporter: "list",
  outputDir: "output/playwright",
});
