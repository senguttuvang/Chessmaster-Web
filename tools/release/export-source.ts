/** Explicit code-only export. Never copies history or recovered game payloads. */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [source, revision] = process.argv.slice(2);
if (!source || !/^[0-9a-f]{40}$/.test(revision ?? "")) {
  throw new Error("Usage: bun tools/release/export-source.ts SOURCE_CHECKOUT FULL_COMMIT_SHA");
}
function git(args: string[]): Uint8Array {
  const result = Bun.spawnSync(["git", "-C", resolve(source), ...args]);
  if (result.exitCode !== 0) throw new Error(`Source Git command failed: ${args[0]}`);
  return result.stdout;
}
const tools = new Set([
  "ExportRecovered.java", "ExportRoomNetwork.java", "ExportUI.java",
  "audit_lesson_media.py", "blast_decode.c", "build_ghidra_decompiler.sh",
  "content_coverage.ts", "inspect_installation.py", "normalize_pe.py",
  "prepare_room_evidence.ts", "recover.py", "recover_content.py",
  "recover_games.ts", "recover_room_art.py", "recover_ui.py", "reference.py",
  "room_evidence.py", "trace_engine.py", "win32_resources.py",
]);
const rootFiles = new Set([
  "package.json", "bun.lock", "pyproject.toml", "uv.lock", "vite.config.ts",
  "playwright.config.ts", "tsconfig.json", "web/index.html", "engine/host.c",
]);
const extensions = /\.(?:ts|css|py|java|c|h|sh)$/;
export function allowed(path: string): boolean {
  if (path.includes("..") || path.startsWith("/")) return false;
  return rootFiles.has(path)
    || (path.startsWith("web/src/") && extensions.test(path))
    || (path.startsWith("tools/") && tools.has(path.slice(6)))
    || (path.startsWith("tests/") && extensions.test(path)
      && path !== "tests/deployment-targets.test.ts")
    || (path.startsWith("vendor/cricket-recompiler/")
      && (extensions.test(path) || /\/(LICENSE|UPSTREAM.md)$/.test(path)))
    || ["vendor/blast/blast.c", "vendor/blast/blast.h"].includes(path);
}
const paths = new TextDecoder().decode(git(["ls-tree", "-r", "--name-only", revision]))
  .trim().split("\n").filter(allowed).sort();
const files = [];
for (const path of paths) {
  const bytes = git(["show", `${revision}:${path}`]);
  // Source export only: NUL indicates an unexpected binary payload.
  if (bytes.includes(0)) throw new Error(`Non-text source rejected: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, bytes);
  files.push({ path, sourceSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    category: path.startsWith("vendor/") ? "licensed-upstream-tooling" : "project-authored-source" });
}
await mkdir("docs/provenance", { recursive: true });
await Bun.write("docs/provenance/source-export.json", JSON.stringify({
  schemaVersion: 1, sourceRevision: revision,
  method: "Explicit source allowlist; no Git objects/history, game payloads or recovery outputs copied. Some exported source is subsequently adapted for BYO media; these hashes identify the input snapshot.",
  files,
}, null, 2) + "\n");
console.log(`Exported ${files.length} reviewed source files; no game data or old history.`);
