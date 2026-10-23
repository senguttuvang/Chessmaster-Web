/** Validate original PGN mainlines with chess.js, preserving original comments and errors. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { parsePgnGames } from "../web/src/pgn";
if (import.meta.main) {
  const source = resolve(import.meta.dir, "../recovery/content/CLASSICG.PGN");
  const raw = await Bun.file(source).arrayBuffer();
  const text = new TextDecoder("windows-1252").decode(raw);
  const games = parsePgnGames(text);
  const data = {
    schemaVersion: 1,
    source: "CLASSICG.PGN",
    sha256: createHash("sha256").update(new Uint8Array(raw)).digest("hex"),
    games,
  };
  await Bun.write(
    resolve(import.meta.dir, "../web/public/content/games.json"),
    JSON.stringify(data, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      games: games.length,
      valid: games.filter((g) => !g.error).length,
      errors: games
        .filter((g) => g.error)
        .map((g) => ({ id: g.id, error: g.error })),
    }),
  );
}
