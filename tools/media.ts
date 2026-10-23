/** Stage a supported user-owned installation without modifying its files. */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const directory = process.argv[2];
if (!directory) throw new Error("Supply your own installed game: make prepare-media GAME_DIR=/absolute/path/to/Chessmaster9000");
const source = resolve(directory);
const required = [
  "THEKING.EXE", "CHESSMAS.EXE", "GUIRESOU.DLL", "CUSTOMGU.DLL", "CM256.DLL",
  "FACES.DAT", "FACES.IDX", "CMSETS.DAT", "CMSETS.IDX", "ANIM.DAT", "ANIM.IDX",
  "CM9000.TTF", "CLASSICG.PGN", "DATABASE.DLL", "MPGAME.DLL", "MPCCEXT.DLL",
  "TBGAME.DLL", "TBKEY.DLL", "TUTORIAL/INTRODUC.TUT", "PERSONAL/AARON.CMP",
];
const missing = [];
for (const name of required) {
  if (!await Bun.file(resolve(source, name)).exists()) missing.push(name);
}
if (missing.length) throw new Error(`Incomplete installation; missing: ${missing.join(", ")}. Extract/install your own media first. No files were staged.`);
const engine = await Bun.file(resolve(source, "THEKING.EXE")).bytes();
const sha256 = new Bun.CryptoHasher("sha256").update(engine).digest("hex");
const supported = "9bd6c1b16251e3a462c61c63b4811605a6072fbeb2311ebe7c05842dd0bfc236";
if (sha256 !== supported) throw new Error(`Unsupported The King build (${sha256}). Expected tested The King3.23 build ${supported}; do not substitute another engine or bypass validation.`);
await mkdir("vendor/original", { recursive: true });
await mkdir("build", { recursive: true });
await Bun.write("vendor/original/THEKING.EXE", engine);
const sources = [];
for (const name of required) {
  const bytes = await Bun.file(resolve(source, name)).bytes();
  sources.push({ file: name, bytes: bytes.length,
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") });
}
await Bun.write("build/media-inputs.json", JSON.stringify({ schemaVersion: 1, sources }, null, 2) + "\n");
console.log("Validated user media. Engine staged only in ignored vendor/original; source installation unchanged.");
// All paths are argv entries, never shell-expanded. Recovery output is ignored.
for (const tool of ["recover.py", "recover_ui.py", "recover_content.py", "recover_room_art.py", "room_evidence.py"]) {
  const child = Bun.spawn([".venv/bin/python", `tools/${tool}`, source], { stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Recovery failed: ${tool}. Do not publish partial outputs.`);
}
for (const tool of ["recover_games.ts", "content_coverage.ts", "prepare_room_evidence.ts"]) {
  const child = Bun.spawn(["bun", `tools/${tool}`], { stdout: "inherit", stderr: "inherit" });
  if (await child.exited !== 0) throw new Error(`Recovery failed: ${tool}. Do not publish partial outputs.`);
}
