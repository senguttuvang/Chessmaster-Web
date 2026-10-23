import { test, expect } from "@playwright/test";
test("computer fixture uses real original engine moves, records draw limit and replays/exports", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#room-tournament").click();
  await expect(page.locator("#tournament-players option")).toHaveCount(156);
  await page.locator("#tournament-human").uncheck();
  await page.locator("#tournament-players").selectOption(["aaron", "niko"]);
  await page.locator("#tournament-limit").fill("2");
  await page.locator("#tournament-create").click();
  await expect(page.locator("#tournament-fixtures tr")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Start fixture", exact: true })
    .click();
  await expect(page.locator("#tournament-message")).toContainText(
    "Result recorded",
    { timeout: 30000 },
  );
  await expect(page.locator("#tournament-live")).toContainText(
    "2 plies played",
  );
  await expect(page.locator("#tournament-fixtures")).toContainText("1/2-1/2");
  const data = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("chessmaster9000.tournament.v1")!),
  );
  expect(data.games[0].pgn).toMatch(/1\./);
  expect(data.games[0].reason).toContain("ply-limit");
  const download = page.waitForEvent("download");
  await page.locator("#tournament-export").click();
  expect((await download).suggestedFilename()).toBe(
    "chessmaster-tournament.pgn",
  );
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.locator("#content-title")).toHaveText("Tournament replay");
  await expect(page.locator("#content-source")).not.toContainText(
    "CLASSICG.PGN",
  );
  await page.locator("#replay-last").click();
  await expect(page.locator("#content-progress")).toContainText("3 / 3");
  await page.reload();
  await page.locator("#room-tournament").click();
  await expect(page.locator("#tournament-fixtures")).toContainText("1/2-1/2");
});
test("human fixture starts The King and explicit resignation updates standings", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#room-tournament").click();
  await expect(page.locator("#tournament-players option")).toHaveCount(156);
  await page.locator("#tournament-players").selectOption(["aaron"]);
  await page.locator("#tournament-create").click();
  await page
    .getByRole("button", { name: "Start fixture", exact: true })
    .click();
  await expect(page.locator("#tournament-banner")).toBeVisible();
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e4]").click();
  await expect(page.locator("#status")).toContainText("Your move");
  await page.locator("#room-tournament").click();
  page.once("dialog", (d) => d.accept());
  await page.locator("#tournament-resign").click();
  await expect(page.locator("#tournament-fixtures")).toContainText("0-1");
  await expect(page.locator("#tournament-message")).toContainText(
    "Human resignation",
  );
});
test("engine failure and unsupported saved event do not create fake results", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#room-tournament").click();
  await expect(page.locator("#tournament-players option")).toHaveCount(156);
  await page.locator("#tournament-human").uncheck();
  await page.locator("#tournament-players").selectOption(["aaron", "niko"]);
  await page.locator("#tournament-create").click();
  await page.route("**/engine/theking.js", (r) => r.abort());
  await page
    .getByRole("button", { name: "Start fixture", exact: true })
    .click();
  await expect(page.locator("#tournament-message")).toContainText("error");
  await expect(page.locator("#tournament-fixtures")).toContainText(
    "Not played",
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "chessmaster9000.tournament.v1",
      '{"schemaVersion":99}',
    ),
  );
  await page.reload();
  await page.locator("#room-tournament").click();
  await expect(page.locator("#tournament-message")).toContainText(
    "Unsupported/corrupt",
  );
});
test("CM Live shows searchable original offline evidence and sends no external requests", async ({
  page,
  baseURL,
}) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (
      new URL(r.url()).origin !== new URL(baseURL!).origin &&
      !/^(blob|data):/.test(r.url())
    )
      external.push(r.url());
  });
  await page.goto("/");
  await page.locator("#room-live").click();
  await expect(page.locator("#live-count")).toContainText(
    "recovered evidence entries",
  );
  await expect(page.locator("#live-status")).toContainText("not restored");
  await page.locator("#live-search").fill("login");
  await expect(page.locator("#live-evidence")).toContainText(
    /Login|login|LOGIN/,
  );
  expect(external).toEqual([]);
  await expect(page.locator("#live-panel input[type=password]")).toHaveCount(0);
});

test("canceling an unfinished computer fixture preserves an unplayed result", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#room-tournament").click();
  await expect(page.locator("#tournament-players option")).toHaveCount(156);
  await page.locator("#tournament-human").uncheck();
  await page.locator("#tournament-players").selectOption(["aaron", "niko"]);
  await page.locator("#tournament-create").click();
  await page.route("**/engine/theking.js", () => {});
  await page
    .getByRole("button", { name: "Start fixture", exact: true })
    .click();
  await page.locator("#tournament-cancel").click();
  await expect(page.locator("#tournament-message")).toContainText(
    "no result recorded",
  );
  await expect(page.locator("#tournament-fixtures")).toContainText(
    "Not played",
  );
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("chessmaster9000.tournament.v1")!)
          .games[0].result ?? null,
    ),
  ).toBeNull();
});

test("invalid stored PGN stays blocked on repeated room opens and preserves source bytes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  const raw = JSON.stringify({
    schemaVersion: 1,
    players: ["aaron", "niko"],
    depth: 2,
    plyLimit: 2,
    games: [
      {
        id: "0-1",
        white: "aaron",
        black: "niko",
        result: "1-0",
        pgn: "invalid moves",
        reason: "test",
      },
    ],
  });
  await page.evaluate(
    (raw) => localStorage.setItem("chessmaster9000.tournament.v1", raw),
    raw,
  );
  for (let i = 0; i < 2; i++) {
    await page.locator("#room-tournament").click();
    await expect(page.locator("#tournament-message")).toContainText(
      "PGN is invalid",
    );
    await page.locator("#tournament-create").click();
    await expect(page.locator("#tournament-message")).toContainText(
      "explicitly reset",
    );
    await page.locator("#room-game").click();
  }
  expect(
    await page.evaluate(() =>
      localStorage.getItem("chessmaster9000.tournament.v1"),
    ),
  ).toBe(raw);
});
