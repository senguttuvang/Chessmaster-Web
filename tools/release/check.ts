/** Fail closed if game payloads, private runtime state or unexpected files enter Git. */
export function releasePathError(path: string): string | undefined {
  if (/^(?:recovery\/|vendor\/original\/|engine\/(?:generated\/|recovered\/|functions\.json$|original\.json$)|web\/public\/(?:assets\/|content\/|rooms\/|engine\/|engine-worker\.js$)|build\/|output\/|\.beads\/|\.codex\/|\.claude\/|\.agents\/)/.test(path)) return "local-only media, recovery or runtime path";
  if (/(?:^|\/)\.env(?:\.|$)|\.(?:exe|dll|dat|idx|wav|raw|ogg|mp3|mp4|png|jpg|jpeg|ttf|gltf|bin|wasm|iso|zip|rar|cab|pem|key)$/i.test(path)) return "binary/media/archive or credential extension";
  if (/credentials/i.test(path)) return "credential filename";
  if (!/\.(?:md|ts|css|html|py|java|c|h|sh|json|toml|lock|yml|yaml)$/.test(path)
    && !/(?:^|\/)(?:LICENSE|Makefile|\.gitignore|\.gitattributes)$/.test(path)) return "unreviewed file type";
  return undefined;
}
function git(args: string[]): Uint8Array {
  const p = Bun.spawnSync(["git", ...args]);
  if (p.exitCode) throw new Error(`Git scan failed: ${args[0]}`);
  return p.stdout;
}
if (import.meta.main) {
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes).trim().split("\n").filter(Boolean);
  const failures: string[] = [];
  for (const path of text(git(["ls-files"]))) {
    const error = releasePathError(path);
    if (error) { failures.push(`${path}: ${error}`); continue; }
    const bytes = await Bun.file(path).bytes();
    if (bytes.includes(0)) failures.push(`${path}: binary content in source file`);
    if (bytes.length > 512 * 1024) failures.push(`${path}: oversized source requires explicit review`);
  }
  // A latest-tree-only check would miss deleted game payloads in earlier commits.
  const commits = text(git(["rev-list", "--all"]));
  const seen = new Set<string>();
  const blobs = new Set<string>();
  for (const commit of commits) {
    for (const row of text(git(["ls-tree", "-r", "--format=%(objectname) %(path)", commit]))) {
      const split = row.indexOf(" ");
      const object = row.slice(0, split), path = row.slice(split + 1);
      if (!seen.has(path)) {
        seen.add(path);
        const error = releasePathError(path);
        if (error) failures.push(`History ${commit.slice(0, 8)} ${path}: ${error}`);
      }
      if (!blobs.has(object)) {
        blobs.add(object);
        const bytes = git(["cat-file", "blob", object]);
        if (bytes.includes(0) || bytes.length > 512 * 1024) failures.push(`History ${commit.slice(0, 8)} ${path}: binary/oversized content`);
      }
    }
  }
  if (failures.length) throw new Error(`Release boundary failed:\n${failures.join("\n")}`);
  console.log(`Release boundary passed: ${commits.length} clean-history commits; ${seen.size} historical paths. This automated guard does not replace source/license review or secret scanning.`);
}
