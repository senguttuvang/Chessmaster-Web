import { test, expect } from "@playwright/test";
const pgn =
  '[Event "Local Test"]\n[White "Alice"]\n[Black "Bob"]\n[Result "*"]\n\n1. e4 {Original local comment <b>text</b>} e5 2. Nf3 *';
test("Database imports, searches, replays, persists, exports and deletes local PGN", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#room-database").click();
  await page.locator("#database-pgn").fill(pgn);
  await page.locator("#database-import").click();
  await expect(page.locator("#database-message")).toContainText("Imported 1");
  await expect(page.locator("#content-count")).toHaveText("1 of 1 games");
  await expect(page.locator("#content-select")).not.toContainText("undefined");
  await page.locator("#replay-next").click();
  await expect(page.locator("#content-text")).toHaveText(
    "Original local comment <b>text</b>",
  );
  await expect(page.locator("[data-square=e4]")).toHaveAttribute(
    "aria-label",
    "e4 white pawn",
  );
  await page.reload();
  await page.locator("#room-database").click();
  await expect(page.locator("#content-count")).toHaveText("1 of 1 games");
  await page.locator("#content-search").fill("Bob");
  await expect(page.locator("#content-select option")).toHaveCount(1);
  const download = page.waitForEvent("download");
  await page.locator("#database-export-selected").click();
  expect((await download).suggestedFilename()).toBe("chessmaster-selected.pgn");
  page.once("dialog", (d) => d.accept());
  await page.locator("#database-delete").click();
  await expect(page.locator("#content-count")).toHaveText("0 of 0 games");
});
test("invalid import and corrupt version are visible and never overwritten", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#room-database").click();
  await page.locator("#database-pgn").fill("not PGN");
  await page.locator("#database-import").click();
  await expect(page.locator("#database-message")).toContainText("error");
  await expect(page.locator("#content-count")).toHaveText("0 of 0 games");
  await page.evaluate(() =>
    localStorage.setItem(
      "chessmaster9000.database.v1",
      '{"schemaVersion":99,"records":[]}',
    ),
  );
  await page.reload();
  await page.locator("#room-database").click();
  await expect(page.locator("#database-message")).toContainText(
    "Unsupported or corrupt",
  );
  await page.locator("#database-pgn").fill(pgn);
  await page.locator("#database-import").click();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("chessmaster9000.database.v1")!)
          .schemaVersion,
    ),
  ).toBe(99);
});
