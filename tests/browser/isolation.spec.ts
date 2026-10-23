import { test, expect } from "@playwright/test";

test("anonymous browser is isolated and loads the original 3D board", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["cross-origin-opener-policy"]).toBe("same-origin");
  expect(response?.headers()["cross-origin-embedder-policy"]).toBe(
    "require-corp",
  );
  expect(
    await page.evaluate(
      () => crossOriginIsolated && typeof SharedArrayBuffer === "function",
    ),
  ).toBe(true);
  await expect(page.locator("#connection")).toContainText("Ready");
  await expect(page.locator("#renderer-state")).toContainText(
    "original 3D set",
  );
  await expect(page.locator("#board-stage canvas")).toBeVisible();
  await page.screenshot({
    path: "output/browser-debugging/deployment-board.png",
    fullPage: true,
  });
});
