import { test, expect } from "@playwright/test";

test("plays original engine replies, rejects illegal input and resets", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e5]").click();
  await expect(page.locator("#moves")).toBeEmpty();
  await page.locator("[data-square=e2]").click();
  await page.locator("[data-square=e4]").click();
  await expect(page.locator("#moves")).toContainText("e4");
  await expect(page.locator("#status")).toContainText("Your move", {
    timeout: 20000,
  });
  await expect(page.locator("#moves li").first()).toContainText(
    /e5|c5|e6|c6|d5|d6|Nf6|Nc6|g6|b6|a6|a5|h6|h5|f5|f6|g5|b5|Na6|Nh6/,
  );
  await page.locator("[data-square=g1]").click();
  await page.locator("[data-square=f3]").click();
  await expect(page.locator("#status")).toContainText("Your move", {
    timeout: 20000,
  });
  await expect(page.locator("#moves")).toContainText("Nf3");
  await page.locator("#new-game").click();
  await expect(page.locator("#connection")).toContainText("Ready");
  await expect(page.locator("#moves")).toBeEmpty();
  await expect(page.locator("[data-square=e2]")).toHaveAttribute(
    "aria-label",
    "e2 white pawn",
  );
});
test("plays black and restarts with recovered personality", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#settings").click();
  await page.locator("#side").selectOption("b");
  await expect(page.locator("#status")).toContainText("Your move", {
    timeout: 20000,
  });
  await expect(page.locator("#moves li")).toHaveCount(1);
  await expect(page.locator("#moves li")).not.toBeEmpty();
  await page.locator("#settings").click();
  await page.locator("#personality").selectOption("aaron");
  await expect(page.locator("#opponent-name")).toHaveText("Aaron");
  await expect(page.locator("#status")).toContainText("Your move", {
    timeout: 20000,
  });
  await expect(page.locator("#connection")).toContainText("Ready");
});
test("mobile board fits viewport and supports keyboard focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.locator("[data-square=e2]").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-square=f2]")).toBeFocused();
  await page.screenshot({
    path: "output/browser-debugging/mobile.png",
    fullPage: true,
  });
});

test("loads positions, promotes with a real engine reply and recognizes mate", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("#load-position").click();
  await page.locator("#fen").fill("invalid");
  await page.getByRole("button", { name: "Start from position" }).click();
  await expect(page.locator("#position-error")).not.toBeEmpty();
  await page.locator("#fen").fill("7k/P7/8/8/8/8/8/7K w - - 0 1");
  await page.getByRole("button", { name: "Start from position" }).click();
  await expect(page.locator("#connection")).toContainText("Ready");
  await page.locator("[data-square=a7]").click();
  await page.locator("[data-square=a8]").click();
  await expect(page.locator("#promotion")).toBeVisible();
  await page.getByRole("button", { name: "queen", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Your move", {
    timeout: 20000,
  });
  await expect(page.locator("[data-square=a8]")).toHaveAttribute(
    "aria-label",
    "a8 white queen",
  );
  await expect(page.locator("#moves")).toContainText("a8=Q");
  await page.locator("#load-position").click();
  await page.locator("#fen").fill("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1");
  await page.getByRole("button", { name: "Start from position" }).click();
  await expect(page.locator("#status")).toHaveText("Checkmate. You won.");
  await expect(page.locator("#connection")).toContainText("Ready");
});
test("engine loading failure is visible and New game can recover", async ({
  page,
}) => {
  await page.route("**/engine/theking.js", (route) => route.abort());
  await page.goto("/");
  await expect(page.locator("#connection")).toHaveText("Engine unavailable");
  await expect(page.locator("#status")).toContainText("Use New game to retry");
  await page.unroute("**/engine/theking.js");
  await page.locator("#new-game").click();
  await expect(page.locator("#connection")).toContainText("Ready");
});
