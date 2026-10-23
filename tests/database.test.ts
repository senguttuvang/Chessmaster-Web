import { test, expect } from "bun:test";
import {
  LocalDatabase,
  DATABASE_KEY,
  type StoragePort,
} from "../web/src/database";
const pgn =
  '[Event "Local"]\n[White "Test"]\n[Black "Other"]\n[Result "*"]\n\n1. e4 {safe <script>text</script>} e5 *';
class Memory implements StoragePort {
  data = new Map<string, string>();
  fail = false;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (this.fail) throw new Error("Quota");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
test("local PGN records round trip with duplicate suppression and narrow deletion", () => {
  const s = new Memory();
  s.setItem("unrelated", "keep");
  const db = new LocalDatabase(s);
  expect(db.import(pgn)).toBe(1);
  expect(db.import(pgn)).toBe(0);
  expect(db.list()).toHaveLength(1);
  expect(new LocalDatabase(s).export()).toContain("<script>");
  const id = db.list()[0].id;
  db.delete(id);
  expect(db.list()).toHaveLength(0);
  expect(s.getItem("unrelated")).toBe("keep");
});
test("invalid batches, quota failures, stale stores and corruption preserve existing bytes", () => {
  const s = new Memory();
  const db = new LocalDatabase(s);
  db.import(pgn);
  const before = s.getItem(DATABASE_KEY);
  expect(() => db.import(pgn + '\n\n[Event "broken"]\n\n1. e9 *')).toThrow();
  expect(s.getItem(DATABASE_KEY)).toBe(before);
  s.fail = true;
  expect(() => db.delete(db.list()[0].id)).toThrow("Quota");
  expect(db.list()).toHaveLength(1);
  expect(s.getItem(DATABASE_KEY)).toBe(before);
  s.fail = false;
  const other = new LocalDatabase(s);
  other.delete(other.list()[0].id);
  expect(() => db.import(pgn)).toThrow("another tab");
  s.setItem(DATABASE_KEY, '{"schemaVersion":9,"records":[]}');
  const corrupt = s.getItem(DATABASE_KEY);
  expect(() => new LocalDatabase(s)).toThrow();
  expect(s.getItem(DATABASE_KEY)).toBe(corrupt);
});
