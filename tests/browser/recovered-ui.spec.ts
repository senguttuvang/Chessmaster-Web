import { test, expect } from "@playwright/test";

async function position(page: import("@playwright/test").Page, fen: string) {
  await page.locator("#load-position").click();
  await page.locator("#fen").fill(fen);
  await page.getByRole("button", { name: "Start from position" }).click();
  await expect(page.locator("#connection")).toContainText("Ready");
}

test("original 3D set supports captures, review, rotation and 2D input", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#renderer-state")).toContainText(
    "original 3D set",
  );
  await expect(page.locator("#board-stage canvas")).toBeVisible();
  await expect(page.locator("#renderer-error")).toBeHidden();
  await position(page, "7k/8/8/8/8/8/p7/R6K w - - 0 1");
  await page.locator("[data-square=a1]").focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-square=a2]").click();
  await expect(page.locator("#status")).toContainText("Your move");
  await expect(page.locator("#captured img")).toHaveCount(1);
  await expect(page.locator("#captured img")).toHaveAttribute(
    "alt",
    "Black pawn",
  );
  await expect(page.locator("#captured-stage canvas")).toBeVisible();
  await page.locator("#history-first").click();
  await expect(page.locator("#history-position")).toHaveText("0/2");
  await expect(page.locator("[data-square=a2]")).toHaveAttribute(
    "aria-label",
    "a2 black pawn",
  );
  await expect(page.locator("#captured img")).toHaveCount(0);
  await page.locator("[data-square=a1]").click();
  await expect(page.locator("[data-square=a1]")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.locator("#history-last").click();
  await expect(page.locator("[data-square=a2]")).toHaveAttribute(
    "aria-label",
    "a2 white rook",
  );
  const before = await page.locator("[data-square=a2]").boundingBox();
  await page.locator("#flip").click();
  const after = await page.locator("[data-square=a2]").boundingBox();
  expect(after!.x).toBeGreaterThan(before!.x + 200);
  await page.locator("#toggle-view").click();
  await expect(page.locator("#board-stage canvas")).toBeHidden();
  await expect(page.locator("#captured img")).toBeVisible();
  await page.locator("[data-square=a2]").click();
  await expect(page.locator("[data-square=a2]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("missing original mesh exposes failure and an explicit playable 2D choice", async ({
  page,
}) => {
  await page.route("**/Staunton_N.gltf", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#renderer-error")).toContainText("could not load");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#toggle-view").click();
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e4]").click();
  await expect(page.locator("#status")).toContainText("Your move");
  await expect(page.locator("#moves")).toContainText("e4");
});

test("original room chrome has working menus, windows, material settings and PGN", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#renderer-state")).toContainText(
    "original 3D set",
  );
  await page.getByRole("button", { name: "Hide Captured Pieces" }).click();
  await expect(page.locator("#captured-window")).toBeHidden();
  await page.getByText("Windows", { exact: true }).click();
  await page.locator("[data-show=captured-window]").click();
  await expect(page.locator("#captured-window")).toBeVisible();
  await page.locator("#settings").click();
  await page.locator("#board-material").selectOption("BoardWoodBurl512");
  await page.locator("#close-settings").click();
  await expect(page.locator("#renderer-error")).toBeHidden();
  const title = page.locator("#shortcuts .panel-title");
  const box = (await title.boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(box.x - 50, box.y + 50);
  await page.mouse.up();
  expect((await title.boundingBox())!.x).toBeLessThan(box.x - 80);
  await page.getByText("Windows", { exact: true }).click();
  await page.locator("#restore-windows").click();
  expect((await title.boundingBox())!.x).toBeCloseTo(box.x, 0);
  await page.getByText("File", { exact: true }).click();
  const download = page.waitForEvent("download");
  await page.locator("[data-action=export]").first().click();
  expect((await download).suggestedFilename()).toBe("chessmaster-game.pgn");
  await page.getByText("Help", { exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".menubar details[open]")).toHaveCount(0);
});

test("reference composition, narrow layout and zoom remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto("/");
  await expect(page.locator("#renderer-state")).toContainText(
    "original 3D set",
  );
  await position(page, "3Q1k2/4Nr2/7p/4R1p1/2p3B1/8/PPP2P1P/R5K1 w - - 0 27");
  await expect(page.locator("#move-count")).toHaveText("Move 27");
  await page.screenshot({
    path: "output/browser-debugging/recovered-reference.png",
    fullPage: true,
  });
  for (const width of [780, 640, 390]) {
    await page.setViewportSize({ width, height: 700 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.locator("[data-square=c2]").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-square=d2]")).toBeFocused();
    await page.evaluate(async () => {
      scrollTo(0, 0);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    });
    if (width === 390)
      await page.screenshot({
        path: "output/browser-debugging/recovered-mobile.png",
        fullPage: true,
      });
  }
  // A 1280px desktop at 200% browser zoom has a 640 CSS-pixel layout viewport.
  await page.setViewportSize({ width: 640, height: 480 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("#load-position").click();
  await expect(page.locator("#fen")).toBeVisible();
  await page.screenshot({
    path: "output/browser-debugging/recovered-zoom.png",
    fullPage: true,
  });
});
