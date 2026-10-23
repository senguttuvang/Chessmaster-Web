import { test, expect } from "bun:test";
import {
  diagram,
  placement,
  lessonFrames,
  ReplayController,
  parseExercise,
  fields,
  type Lesson,
} from "../web/src/replay";
import { parsePgnGames, normalizeLegacyPgn } from "../web/src/pgn";

test("teaching diagrams expand multi-rank empties without inventing kings", () => {
  const d = diagram("32/3R4/24 BLACK");
  expect(d.board).toEqual({ d4: "R" });
  expect(d.turn).toBe("b");
  expect(placement(d.board)).toBe("8/8/8/8/3R4/8/8/8");
  expect(() => diagram("63")).toThrow("63 squares");
});
test("original sequencing preserves demonstrations, diagrams and nested exercise boundaries", () => {
  const l: Lesson = {
    id: "test",
    title: "test",
    source: "fixture",
    sha256: "test",
    steps: [
      {
        number: 1,
        raw: "",
        tokens: [
          { kind: "command", name: "B", argument: "32/3R4/24 WHITE", raw: "" },
          { kind: "text", text: "A rook." },
          { kind: "command", name: "S", argument: "d4d8", raw: "" },
          {
            kind: "command",
            name: "V",
            argument: "Move back.{W:clip};d8d4;Correct.{W:cor};Try again.",
            raw: "",
          },
        ],
      },
    ],
  };
  const frames = lessonFrames(l);
  expect(frames[1].board).toEqual({ d4: "R" });
  expect(frames.at(-1)!.board).toEqual({ d8: "R" });
  expect(frames.at(-1)!.exercise?.answer).toBe("d8d4");
  const replay = new ReplayController(frames);
  replay.seek(Infinity);
  expect(replay.current.exercise?.prompt).toBe("Move back.");
  replay.seek(-99);
  expect(replay.index).toBe(0);
  expect(frames[1].board).toEqual({ d4: "R" });
});
test("source choice formats grade by explicit original answer/feedback and preserve scores", () => {
  expect(fields("Prompt{W:a;b};Yes;Bad;No;Correct.;2")).toHaveLength(6);
  expect(
    parseExercise("Q", "Question;Yes;Bad;No;Correct.;2").choices?.map(
      (c) => c.correct,
    ),
  ).toEqual([false, true]);
  const qm = parseExercise("QM", "Move?;e4:Incorrect.:2;d4:Correct.:4");
  expect(qm.choices?.[0].correct).toBe(false);
  expect(qm.choices?.[1].sourceScore).toBe("4");
});
test("legacy PGN adaptations affect notation only and real recovered games all replay legally", async () => {
  const pgn = '[Event "x?!"]\n\n1 e4!? {keep ?! bxc3ep 36 text} e5 *';
  const n = normalizeLegacyPgn(pgn);
  expect(n).toContain('[Event "x?!"]');
  expect(n).toContain("{keep ?! bxc3ep 36 text}");
  expect(parsePgnGames(pgn)[0].frames).toHaveLength(3);
  const games = await Bun.file("web/public/content/games.json").json();
  expect(games.games).toHaveLength(825);
  expect(games.games.filter((g: { error: unknown }) => g.error)).toHaveLength(
    0,
  );
  expect(games.games[0].headers.White).toBe("Gioachino Greco");
  expect(games.games[0].frames.at(-1).san).toBe("Bg6#");
});
