import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

test.beforeAll(() => {
  expect(existsSync("web/public/audio/index.json"),
    "Prepare your own recovered media with tools/prepare_browser_audio.py before the audio browser checks").toBe(true);
});
test.afterEach(async ({page}, info) => {
  if (!page.isClosed())
    await info.attach("original-media-playback", { body:JSON.stringify(await page.evaluate(() =>
      (window as unknown as {audioProof:unknown}).audioProof ?? []), null, 2), contentType:"application/json" });
});

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const proof: {id: string; channel: string; time: number; duration: number; event: string}[] = [];
    (window as unknown as { audioProof: typeof proof }).audioProof = proof;
    for (const event of ["playing", "timeupdate"]) document.addEventListener(event, ev => {
      const audio = ev.target;
      if (audio instanceof HTMLAudioElement && audio.dataset.clip)
        proof.push({id:audio.dataset.clip, channel:audio.dataset.audioChannel!, time:audio.currentTime, duration:audio.duration, event});
    }, true);
  });
}
async function played(page: Page, id: string) {
  await page.waitForFunction(id => (window as unknown as {audioProof:{id:string;event:string;time:number}[]}).audioProof
    .some(p => p.id === id && p.event === "timeupdate" && p.time > 0), id);
}
async function position(page: Page, fen: string) {
  await page.locator("#load-position").click();
  await page.locator("#fen").fill(fen);
  await page.getByRole("button", { name:"Start from position" }).click();
  await expect(page.locator("#connection")).toContainText("Ready");
}
async function move(page: Page, from: string, to: string) {
  await page.locator("[data-square=" + from + "]").click();
  await page.locator("[data-square=" + to + "]").click();
}

test("original media supports native audio byte ranges, HEAD and missing-file 404", async ({request}) => {
  const index = await (await request.get("/audio/index.json")).json();
  const url = index.clips["cmsets:WMove.raw"].url;
  const full = await request.get(url); expect(full.status()).toBe(200);
  const bytes = await full.body();
  const range = await request.get(url,{headers:{Range:"bytes=0-15"}});
  expect(range.status()).toBe(206);
  expect(await range.body()).toEqual(bytes.subarray(0,16));
  expect(range.headers()["content-range"]).toBe(`bytes 0-15/${bytes.length}`);
  const head = await request.head(url); expect(head.status()).toBe(200); expect((await head.body()).length).toBe(0);
  expect((await request.get("/audio/clips/cmsets/" + "0".repeat(64) + ".wav",{headers:{Accept:"audio/wav"}})).status()).toBe(404);
});

test("actual human/engine moves, captures, castle, promotion, check and mate play original clips", async ({page}) => {
  await observeAudio(page);
  await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await move(page, "e2", "e4");
  await played(page, "cmsets:WMove.raw");
  await played(page, "cmsets:BMove.raw");
  await expect(page.locator("#moves")).toContainText("e4");
  await expect(page.locator("#status")).toContainText("Your move");
  await position(page, "7k/8/8/8/8/1n6/P7/7K w - - 0 1");
  await move(page,"a2","b3"); await played(page,"cmsets:Capture.raw");
  await position(page, "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  await move(page,"e1","g1"); await played(page,"cmsets:castle.raw");
  await position(page, "7k/P7/8/8/8/8/8/7K w - - 0 1");
  await move(page,"a7","a8");
  await page.getByRole("button",{name:"queen",exact:true}).click();
  await played(page,"cmsets:promote.raw"); await played(page,"cmsets:check.raw");
  await position(page, "7k/8/5KQ1/8/8/8/8/8 w - - 0 1");
  await move(page,"g6","g7"); await played(page,"cmsets:checkmate.raw");
  await expect(page.locator("#status")).toContainText("Checkmate");
  await position(page, "7k/8/8/8/b7/8/1N6/7K w - - 0 1");
  await move(page, "b2", "a4"); await played(page, "cmsets:draw.raw");
  await expect(page.locator("#status")).toContainText("Draw");
  await expect(page.locator("#audio-error")).toBeEmpty();
  await page.screenshot({path:"output/browser-debugging/integrated-audio-game.png",fullPage:true});
});

test("original exercise feedback, illustration and illegal-action sound work in the game UI", async ({page}) => {
  await observeAudio(page); await page.goto("/");
  await expect(page.locator("#connection")).toContainText("Ready");
  await move(page, "e2", "e5"); await played(page, "loose:Illegal.wav");
  await expect(page.locator("#moves")).toBeEmpty();
  await page.locator("#room-classroom").click();
  await page.locator("#content-select").selectOption("algebrai");
  await page.locator("#lesson-step").selectOption("9");
  await page.locator("#replay-step-end").click();
  await expect(page.locator("#exercise-prompt")).toContainText("algebraic notation");
  await page.locator("#exercise-answer").fill("e4");
  await page.getByRole("button",{name:"Check answer",exact:true}).click();
  await played(page,"tutorial:cor.raw");
  await expect(page.locator("#content-feedback")).toContainText("Correct");
  await page.locator("#exercise-answer").fill("wrong");
  await page.getByRole("button",{name:"Check answer",exact:true}).click();
  await played(page,"tutorial:NOT_004.raw");
  await page.locator("#content-select").selectOption("the_bish");
  await page.locator("#replay-step-end").click();
  const image = page.locator("#lesson-illustration");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", /BISHOPS.BMP/);
  expect(await image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.screenshot({path:"output/browser-debugging/integrated-audio-lesson.png",fullPage:true});
});

test("real tutorial voices follow source steps, pause demonstration, cancel on navigation and mute", async ({page}) => {
  await observeAudio(page); await page.goto("/");
  await page.locator("#room-classroom").click();
  await page.locator("#content-select").selectOption("algebrai");
  await played(page,"tutorial:ANL_001.raw");
  const first = await page.locator("#content-progress").textContent();
  await page.locator("#replay-auto").click();
  await page.waitForTimeout(1200);
  await expect(page.locator("#content-progress")).toHaveText(first!);
  await page.locator("#stop-narration").click();
  await expect(page.locator("#replay-auto")).toHaveText("Play demonstration");
  expect(await page.locator('audio[data-audio-channel=narration]').evaluate(a => (a as HTMLAudioElement).paused)).toBe(true);
  await page.locator("#lesson-step").selectOption("1");
  await played(page,"tutorial:ANL_002.raw");
  await page.locator("#content-search").fill("no lesson has this title");
  await expect(page.locator("#content-progress")).toHaveText("No selection");
  expect(await page.locator('audio[data-audio-channel=narration]').evaluate(a => (a as HTMLAudioElement).hasAttribute("src"))).toBe(false);
  await expect(page.locator("#lesson-illustration")).toBeHidden();
  await expect(page.locator("#replay-narration")).toBeDisabled();
  await page.locator("#room-library").click();
  await expect(page.locator("#replay-narration")).toBeHidden();
  await expect(page.locator("#stop-narration")).toBeHidden();
  await page.locator("#room-game").click();
  expect(await page.locator('audio[data-audio-channel=narration]').evaluate(a => (a as HTMLAudioElement).hasAttribute("src"))).toBe(false);
  await page.locator("#sound-enabled").uncheck();
  const count = await page.locator('audio[data-audio-channel=effect]').getAttribute("data-play-count");
  await expect(page.locator("#connection")).toContainText("Ready");
  await move(page,"e2","e4"); await expect(page.locator("#status")).toContainText("Your move");
  expect(await page.locator('audio[data-audio-channel=effect]').getAttribute("data-play-count")).toBe(count);
  await page.reload(); await expect(page.locator("#sound-enabled")).not.toBeChecked();
});

test("missing media is visible and retry restores actual tutorial playback", async ({page}) => {
  await observeAudio(page);
  await page.route("**/audio/index.json", r => r.fulfill({status:404,body:"missing"}));
  await page.goto("/"); await page.locator("#room-classroom").click();
  await page.locator("#content-select").selectOption("algebrai");
  await expect(page.locator("#audio-error")).toContainText("not prepared");
  await page.unroute("**/audio/index.json");
  await page.locator("#enable-sound").click();
  await played(page,"tutorial:ANL_001.raw");
  await page.route("**/audio/clips/tutorial/**", r => r.fulfill({status:404,body:"missing"}));
  await page.locator("#replay-narration").click();
  await expect(page.locator("#audio-error")).toContainText("Cannot load");
  await page.unroute("**/audio/clips/tutorial/**");
  await page.locator("#enable-sound").click();
  await expect(page.locator("#audio-error")).toBeEmpty();
  await page.locator("#stop-narration").click();
  await page.locator("#room-game").click();
  await expect(page.locator("#connection")).toContainText("Ready");
  await move(page,"e2","e4"); await played(page,"cmsets:WMove.raw");
});
