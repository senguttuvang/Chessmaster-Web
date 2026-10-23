import { expect, test } from "bun:test";
import { releasePathError } from "../tools/release/check";
import { mkdir, mkdtemp, unlink } from "node:fs/promises";
import { resolve } from "node:path";

test("reject original binaries, generated instructions, recovered content and private state", () => {
  for (const path of ["vendor/original/THEKING.EXE", "engine/generated/recomp.c", "engine/recovered/king.c", "engine/functions.json", "recovery/content/lesson.TUT", "web/public/assets/font.ttf", "web/public/content/lessons.json", "web/public/engine/theking.js", "docs/disc.iso", "docs/renamed.bin", ".env.local", ".beads/issues.jsonl"]) {
    expect(releasePathError(path), path).toBeDefined();
  }
});
test("accept independently authored code and licensed source tooling", () => {
  for (const path of ["engine/host.c", "web/src/main.ts", "tools/recover.py", "vendor/cricket-recompiler/LICENSE", "docs/engineering-history.md", "Makefile", ".gitignore"]) expect(releasePathError(path), path).toBeUndefined();
});
test("missing installation fails without creating media payloads", async () => {
  const p = Bun.spawn(["bun", "tools/media.ts", "build/nonexistent-installation"], { stdout: "pipe", stderr: "pipe" });
  expect(await p.exited).not.toBe(0);
  expect(await new Response(p.stderr).text()).toContain("Incomplete installation");
});

for (const fixture of ["web/public/assets/synthetic.png", "fixtures/renamed.ts"]) {
  test(`history scan rejects removed payload: ${fixture}`, async () => {
    await mkdir("build", { recursive: true });
    const directory = await mkdtemp(resolve("build/release-fixture-"));
    function git(...args: string[]) {
      const p = Bun.spawnSync(["git", "-c", "user.name=Release Fixture", "-c", "user.email=fixture@example.invalid", ...args], { cwd: directory });
      if (p.exitCode) throw new Error("Synthetic Git fixture failed");
    }
    git("init", "--quiet");
    const path = resolve(directory, fixture);
    await mkdir(resolve(path, ".."), { recursive: true });
    await Bun.write(path, new Uint8Array([0, 1, 2, 3]));
    git("add", "."); git("commit", "--quiet", "-m", "synthetic payload fixture");
    await unlink(path);
    await Bun.write(resolve(directory, "README.md"), "Synthetic clean latest tree\n");
    git("add", "-A"); git("commit", "--quiet", "-m", "remove fixture from latest tree");
    const check = Bun.spawn(["bun", resolve("tools/release/check.ts")], { cwd: directory, stdout: "pipe", stderr: "pipe" });
    expect(await check.exited).not.toBe(0);
    const error = await new Response(check.stderr).text();
    expect(error).toContain("History");
    expect(error).toContain(fixture);
  });
}
