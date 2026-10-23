/** Validate original PGN mainlines with chess.js, preserving original comments and errors. */
import { Chess } from "chess.js";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
export function normalizeLegacyPgn(pgn: string): string {
  return pgn
    .split(/(\{[^}]*\}|\[[^\]]*\]|;[^\n]*)/g)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(/([a-h]x[a-h][1-8])ep\b/g, "$1")
            .replace(/[!?]+/g, "")
            .replace(/\b(\d+)\s+(?=[KQRBNa-hO])/g, "$1. "),
    )
    .join("");
}
export function recoverGames(text: string) {
  return text
    .split(/(?=^\[Event\s)/m)
    .filter((s) => s.trim())
    .map((pgn, index) => {
      const id = `classic-${index + 1}`;
      const headers = Object.fromEntries(
        [...pgn.matchAll(/^\[(\w+) "(.*)"\]/gm)].map((m) => [m[1], m[2]]),
      );
      try {
        const game = new Chess();
        game.loadPgn(normalizeLegacyPgn(pgn));
        const history = game.history({ verbose: true });
        const comments = game.getComments();
        const initial = history[0]?.before ?? game.fen();
        return {
          id,
          headers,
          pgn,
          error: null,
          frames: [
            {
              fen: initial,
              san: "Start",
              comment: comments.find((c) => c.fen === initial)?.comment ?? "",
            },
            ...history.map((m) => ({
              fen: m.after,
              san: m.san,
              comment: comments.find((c) => c.fen === m.after)?.comment ?? "",
            })),
          ],
        };
      } catch (error) {
        return { id, headers, pgn, error: String(error), frames: [] };
      }
    });
}
if (import.meta.main) {
  const source = resolve(import.meta.dir, "../recovery/content/CLASSICG.PGN");
  const raw = await Bun.file(source).arrayBuffer();
  const text = new TextDecoder("windows-1252").decode(raw);
  const games = recoverGames(text);
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
