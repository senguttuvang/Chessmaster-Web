/** PGN dialect adapter and legal mainline parsing shared by recovery and local records. */
import { Chess } from "chess.js";
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
export function parsePgnGames(text: string) {
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
