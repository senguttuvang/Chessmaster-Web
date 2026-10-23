import { test, expect } from "@playwright/test";
test("Classroom recovers real explanation, kingless diagrams and board exercises", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e4]").click();
  await expect(page.locator("#status")).toContainText("Your move");
  await page.locator("#room-classroom").click();
  await expect(page.locator("#content-count")).toHaveText("73 of 73 lessons");
  await page.locator("#content-search").fill("Chess Piece Summary");
  await page.locator("#content-select").selectOption("chess_pi");
  await page.locator("#lesson-step").selectOption("0");
  await page.locator("#replay-step-end").click();
  await expect(page.locator("#content-text")).toContainText(
    "Chess pieces in position",
  );
  await page.locator("#lesson-step").selectOption("8");
  await page.locator("#replay-step-end").click();
  await expect(page.locator("#exercise-prompt")).toContainText("Capture one");
  await page.locator("[data-square=f1]").click();
  await page.locator("[data-square=a6]").click();
  await expect(page.locator("#content-feedback")).toContainText("Correct");
  await expect(page.locator("[data-square=a6]")).toHaveAttribute(
    "aria-label",
    "a6 white bishop",
  );
  await page.locator("#room-game").click();
  await expect(page.locator("#moves")).toContainText("e4");
  await expect(page.locator("[data-square=e4]")).toHaveAttribute(
    "aria-label",
    "e4 white pawn",
  );
});
test("Library searches original games, replays comments and hands a position to The King", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#room-library").click();
  await expect(page.locator("#content-count")).toHaveText("825 of 825 games");
  await page.locator("#content-search").fill("Gioachino Greco");
  await page.locator("#content-select").selectOption("classic-1");
  await expect(page.locator("#content-text")).toContainText("time machine");
  await page.locator("#replay-next").click();
  await expect(page.locator("[data-square=e4]")).toHaveAttribute(
    "aria-label",
    "e4 white pawn",
  );
  await page.locator("#replay-last").click();
  await expect(page.locator("#content-progress")).toContainText("Bg6#");
  await page.locator("#replay-first").click();
  await page.locator("#play-replay").click();
  await expect(page.locator("#content-panel")).toBeHidden();
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e4]").click();
  await expect(page.locator("#status")).toContainText("Your move");
});
test("content errors stay visible and room reentry retries", async ({
  page,
}) => {
  await page.route("**/content/lessons.json", (r) => r.abort());
  await page.goto("/");
  await page.locator("#room-classroom").click();
  await expect(page.locator("#content-progress")).toHaveText(
    "Content unavailable",
  );
  await page.unroute("**/content/lessons.json");
  await page.locator("#room-game").click();
  await page.locator("#room-classroom").click();
  await expect(page.locator("#content-count")).toHaveText("73 of 73 lessons");
});
