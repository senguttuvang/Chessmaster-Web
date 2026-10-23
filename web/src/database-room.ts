import { DATABASE_KEY, LocalDatabase } from "./database";
import { parsePgnGames } from "./pgn";
import type { ContentRoom } from "./content-room";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export function downloadPgn(text: string, name: string): void {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/x-chess-pgn" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
export class DatabaseRoom {
  private database: LocalDatabase | undefined;
  constructor(
    private content: ContentRoom,
    private currentGame: () => string,
  ) {
    $("database-import").onclick = () =>
      this.import($<HTMLTextAreaElement>("database-pgn").value, "Pasted PGN");
    $("database-file").onchange = async () => {
      const file = $<HTMLInputElement>("database-file").files?.[0];
      if (!file) return;
      try {
        if (file.size > 10_000_000) throw new Error("PGN exceeds 10 MB limit");
        const bytes = await file.arrayBuffer();
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          text = new TextDecoder("windows-1252").decode(bytes);
        }
        this.import(text, file.name);
      } catch (error) {
        this.error(error);
      }
    };
    $("database-save-game").onclick = () =>
      this.import(this.currentGame(), "Game Room");
    $("database-export").onclick = () =>
      this.act(() =>
        downloadPgn(this.database!.export(), "chessmaster-database.pgn"),
      );
    $("database-export-selected").onclick = () =>
      this.act(() =>
        downloadPgn(
          this.database!.export(this.content.selectedId),
          "chessmaster-selected.pgn",
        ),
      );
    $("database-delete").onclick = () =>
      this.act(() => {
        if (!confirm("Delete the selected local game?")) return;
        this.database!.delete(this.content.selectedId);
        this.refresh();
        $("database-message").textContent = "Local game deleted.";
      });
    $("database-raw").onclick = () => {
      try {
        downloadPgn(
          localStorage.getItem(DATABASE_KEY) ?? "",
          "chessmaster-database-recovery.json",
        );
      } catch (error) {
        this.error(error);
      }
    };
    $("database-reset").onclick = () => {
      if (
        !confirm(
          "Reset only this browser’s Chessmaster local database? Export recovery data first.",
        )
      )
        return;
      try {
        localStorage.removeItem(DATABASE_KEY);
        this.open();
      } catch (error) {
        this.error(error);
      }
    };
  }
  open(): void {
    try {
      this.database = new LocalDatabase(localStorage);
      this.refresh();
      $("database-message").textContent =
        "Browser-local PGN records. No original user profiles or online database are accessed.";
    } catch (error) {
      this.database = undefined;
      void this.content.openDatabase([]);
      this.error(error);
    }
  }
  private refresh(): void {
    const games = this.database!.list().map((r) => {
      const g = parsePgnGames(r.pgn)[0];
      return { ...g, id: r.id };
    });
    void this.content.openDatabase(games);
  }
  private import(pgn: string, origin: string): void {
    this.act(() => {
      const count = this.database!.import(pgn, origin);
      this.refresh();
      $<HTMLTextAreaElement>("database-pgn").value = "";
      $("database-message").textContent =
        `Imported ${count} new game${count === 1 ? "" : "s"}. Duplicate records are ignored.`;
    });
  }
  private act(action: () => void): void {
    if (!this.database) {
      this.error(
        new Error(
          "Database unavailable. Export recovery data or explicitly reset the local store.",
        ),
      );
      return;
    }
    try {
      action();
    } catch (error) {
      this.error(error);
    }
  }
  private error(error: unknown): void {
    $("database-message").textContent =
      `Local database error: ${String(error)}. Existing stored data was preserved.`;
  }
}
