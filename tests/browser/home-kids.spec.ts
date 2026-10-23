import { test, expect } from "@playwright/test";
test("Home routes real rooms and preserves Game Room state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e4]").click();
  await expect(page.locator("#status")).toContainText("Your move");
  await page.locator("#room-home").click();
  await expect(page.locator("#landing-title")).toHaveText("Home");
  await expect(page.locator("#board-stage")).toBeHidden();
  await page.locator("[data-room-choice=library]").click();
  await expect(page.locator("#content-count")).toHaveText("825 of 825 games");
  await page.locator("#room-game").click();
  await expect(page.locator("#moves")).toContainText("e4");
  await expect(page.locator("[data-square=e4]")).toHaveAttribute(
    "aria-label",
    "e4 white pawn",
  );
});
test("Kids opens genuine beginner lessons and starts an original-personality game", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#room-kids").click();
  await expect(page.locator("#kids-lesson option")).toHaveCount(11);
  await page.locator("#kids-lesson").selectOption("chess_pi");
  await page.locator("#kids-learn").click();
  await expect(page.locator("#content-select")).toHaveValue("chess_pi");
  await page.locator("#replay-step-end").click();
  await expect(page.locator("#content-text")).toContainText(
    "Chess pieces in position",
  );
  await page.locator("#room-kids").click();
  await page.locator("[data-kids-profile=aaron]").click();
  await expect(page.locator("#landing-panel")).toBeHidden();
  await expect(page.locator("#connection")).toContainText("Ready");
  await expect(page.locator("#opponent-name")).toHaveText("Aaron");
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e4]").click();
  await expect(page.locator("#status")).toContainText("Your move");
});
test("Home/Kids reflow at phone width with working return navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator("#room-home").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("[data-room-choice=kids]").click();
  await expect(page.locator("#kids-lesson option")).toHaveCount(11);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "output/rooms/kids-mobile.png",
    fullPage: true,
  });
});
