/** Versioned, transactional browser-local PGN records; no original database access. */
import { parsePgnGames } from "./pgn";
export const DATABASE_KEY = "chessmaster9000.database.v1";
export type RecordGame = {
  id: string;
  pgn: string;
  createdAt: string;
  origin: string;
};
export type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export class LocalDatabase {
  private records: RecordGame[] = [];
  private blocked = false;
  private snapshot: string | null = null;
  constructor(private storage: StoragePort) {
    this.load();
  }
  private load(): void {
    try {
      const raw = this.storage.getItem(DATABASE_KEY);
      this.snapshot = raw;
      if (!raw) return;
      const data: unknown = JSON.parse(raw);
      if (
        !data ||
        typeof data !== "object" ||
        !("schemaVersion" in data) ||
        data.schemaVersion !== 1 ||
        !("records" in data) ||
        !Array.isArray(data.records) ||
        data.records.length > 1000
      )
        throw new Error("Unsupported or corrupt local database");
      const ids = new Set<string>();
      for (const r of data.records) {
        if (
          !r ||
          typeof r.id !== "string" ||
          ids.has(r.id) ||
          typeof r.pgn !== "string" ||
          typeof r.origin !== "string" ||
          typeof r.createdAt !== "string"
        )
          throw new Error("Invalid local game record");
        ids.add(r.id);
        const parsed = parsePgnGames(r.pgn);
        if (parsed.length !== 1 || parsed[0].error)
          throw new Error("Stored PGN is invalid");
      }
      this.records = data.records;
    } catch (error) {
      this.blocked = true;
      throw error;
    }
  }
  list(): readonly RecordGame[] {
    return this.records.map((r) => ({ ...r }));
  }
  private save(next: RecordGame[]): void {
    if (this.blocked)
      throw new Error("Database is blocked; export raw data before resetting.");
    if (next.length > 1000)
      throw new Error(
        "Local database limit is 1000 games. Export and remove games before importing more.",
      );
    if (this.storage.getItem(DATABASE_KEY) !== this.snapshot)
      throw new Error(
        "Local database changed in another tab. Reopen Database before editing.",
      );
    const serialized = JSON.stringify({ schemaVersion: 1, records: next });
    this.storage.setItem(DATABASE_KEY, serialized);
    this.snapshot = serialized;
    this.records = next;
  }
  import(text: string, origin = "Imported PGN"): number {
    if (new TextEncoder().encode(text).byteLength > 10_000_000)
      throw new Error("PGN exceeds the 10 MB import limit.");
    const games = parsePgnGames(text);
    if (!games.length) throw new Error("No PGN games found.");
    const invalid = games.find((g) => g.error);
    if (invalid) throw new Error(`${invalid.id}: ${invalid.error}`);
    const next = [...this.records];
    const known = new Set(next.map((r) => r.pgn.replace(/\r\n/g, "\n").trim()));
    for (const game of games) {
      const key = game.pgn.replace(/\r\n/g, "\n").trim();
      if (known.has(key)) continue;
      known.add(key);
      next.push({
        id: crypto.randomUUID(),
        pgn: game.pgn,
        createdAt: new Date().toISOString(),
        origin,
      });
    }
    const count = next.length - this.records.length;
    this.save(next);
    return count;
  }
  delete(id: string): void {
    if (!this.records.some((r) => r.id === id))
      throw new Error("Game no longer exists");
    this.save(this.records.filter((r) => r.id !== id));
  }
  export(id?: string): string {
    const records = id ? this.records.filter((r) => r.id === id) : this.records;
    if (id && !records.length) throw new Error("Game no longer exists");
    return records.map((r) => r.pgn.trim()).join("\n\n") + "\n";
  }
}
