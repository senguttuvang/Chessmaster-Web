/** Local round-robin rules; original source documents scoring, browser owns scheduling. */
export type Result = "1-0" | "0-1" | "1/2-1/2";
export type Fixture = {
  id: string;
  white: string;
  black: string;
  result?: Result;
  pgn?: string;
  reason?: string;
};
export type Standing = {
  id: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
};
export function fixtures(players: string[]): Fixture[] {
  if (
    players.length < 2 ||
    players.length > 5 ||
    players.some((p) => typeof p !== "string") ||
    new Set(players).size !== players.length
  )
    throw new Error("Choose 2–5 unique participants");
  const result: Fixture[] = [];
  for (let i = 0; i < players.length; i++)
    for (let j = i + 1; j < players.length; j++) {
      const reverse = (i + j) % 2 === 0;
      result.push({
        id: `${i}-${j}`,
        white: reverse ? players[j] : players[i],
        black: reverse ? players[i] : players[j],
      });
    }
  return result;
}
export function standings(players: string[], games: Fixture[]): Standing[] {
  const rows = new Map<string, Standing>(
    players.map((id) => [
      id,
      { id, played: 0, wins: 0, draws: 0, losses: 0, points: 0 },
    ]),
  );
  for (const g of games) {
    if (!g.result) continue;
    const w = rows.get(g.white),
      b = rows.get(g.black);
    if (!w || !b) throw new Error("Unknown fixture participant");
    w.played++;
    b.played++;
    if (g.result === "1/2-1/2") {
      w.draws++;
      b.draws++;
      w.points += 0.5;
      b.points += 0.5;
    } else {
      const winner = g.result === "1-0" ? w : b,
        loser = g.result === "1-0" ? b : w;
      winner.wins++;
      winner.points++;
      loser.losses++;
    }
  }
  return [...rows.values()].sort(
    (a, b) =>
      b.points - a.points || b.wins - a.wins || a.id.localeCompare(b.id),
  );
}
export type EventData = {
  schemaVersion: 1;
  players: string[];
  games: Fixture[];
  depth: number;
  plyLimit: number;
};
export function validateEvent(value: unknown): EventData {
  if (!value || typeof value !== "object")
    throw new Error("Invalid tournament data");
  const v = value as EventData;
  if (
    v.schemaVersion !== 1 ||
    !Array.isArray(v.players) ||
    v.players.some((p) => typeof p !== "string") ||
    !Array.isArray(v.games) ||
    ![2, 4].includes(v.depth) ||
    !Number.isInteger(v.plyLimit) ||
    v.plyLimit < 2 ||
    v.plyLimit > 200
  )
    throw new Error("Unsupported/corrupt tournament data");
  const expected = fixtures(v.players);
  if (expected.length !== v.games.length) throw new Error("Invalid fixtures");
  for (let i = 0; i < expected.length; i++) {
    const g = v.games[i];
    if (
      !g ||
      g.id !== expected[i].id ||
      g.white !== expected[i].white ||
      g.black !== expected[i].black ||
      (g.result && !["1-0", "0-1", "1/2-1/2"].includes(g.result)) ||
      (g.result && (typeof g.pgn !== "string" || typeof g.reason !== "string"))
    )
      throw new Error("Invalid fixture result");
  }
  return v;
}
