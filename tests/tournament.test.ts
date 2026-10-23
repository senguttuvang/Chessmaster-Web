import { test, expect } from "bun:test";
import { fixtures, standings, validateEvent } from "../web/src/tournament";
test("single round robin covers each pair once and preserves actual 1/half/0 scoring", () => {
  const players = ["you", "aaron", "niko", "josh"];
  const games = fixtures(players);
  expect(games).toHaveLength(6);
  expect(
    new Set(games.map((g) => [g.white, g.black].sort().join("/"))).size,
  ).toBe(6);
  games[0].result = "1-0";
  games[1].result = "1/2-1/2";
  const rows = standings(players, games);
  expect(rows.reduce((n, r) => n + r.played, 0)).toBe(4);
  expect(rows.reduce((n, r) => n + r.points, 0)).toBe(2);
  expect(rows[0].points).toBe(1.5);
});
test("corrupt participants, fabricated fixtures/results and limits are rejected", () => {
  const base = {
    schemaVersion: 1 as const,
    players: ["aaron", "niko"],
    games: fixtures(["aaron", "niko"]),
    depth: 2,
    plyLimit: 2,
  };
  expect(validateEvent(base)).toEqual(base);
  expect(() => fixtures(["you", "you"])).toThrow();
  expect(() => validateEvent({ ...base, players: [1, 2] })).toThrow();
  expect(() => validateEvent({ ...base, plyLimit: 0 })).toThrow();
  expect(() =>
    validateEvent({ ...base, games: [{ ...base.games[0], result: "1-0" }] }),
  ).toThrow();
});
