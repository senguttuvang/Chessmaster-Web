import { Chess, type Color } from "chess.js";
import { EngineMatch, type Profile } from "./engine-match";
import {
  fixtures,
  standings,
  validateEvent,
  type EventData,
  type Result,
} from "./tournament";
import { parsePgnGames } from "./pgn";
import { downloadPgn } from "./database-room";
import type { ContentRoom } from "./content-room";
const KEY = "chessmaster9000.tournament.v1";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export class TournamentRoom {
  private loadFailed = false;
  private snapshot: string | null = null;
  private event: EventData | undefined;
  private profiles: readonly Profile[] = [];
  private active: string | undefined;
  private humanGeneration: number | undefined;
  private runner: EngineMatch | undefined;
  private serial = 0;
  constructor(
    private content: ContentRoom,
    private beginHuman: (profile: string, color: Color) => number,
    private currentPgn: () => string,
    private stopHuman: () => void,
  ) {
    $("tournament-raw").onclick = () => {
      try {
        downloadPgn(
          localStorage.getItem(KEY) ?? "",
          "chessmaster-tournament-recovery.json",
        );
      } catch (error) {
        this.message(error);
      }
    };
    $("tournament-reset").onclick = () => {
      if (
        !confirm(
          "Reset this local tournament only? Export completed games or recovery data first.",
        )
      )
        return;
      this.cancel();
      try {
        localStorage.removeItem(KEY);
        this.event = undefined;
        this.snapshot = null;
        this.loadFailed = false;
        this.render();
      } catch (error) {
        this.message(error);
      }
    };
    $("tournament-create").onclick = () => this.create();
    $("tournament-cancel").onclick = () => this.cancel();
    $("tournament-resign").onclick = () => {
      if (!confirm("Resign the active human tournament game?")) return;
      this.humanResult(
        this.humanColor() === "w" ? "0-1" : "1-0",
        "Human resignation",
      );
    };
    $("tournament-draw").onclick = () => {
      if (!confirm("Adjudicate the active human game as a local draw?")) return;
      this.humanResult(
        "1/2-1/2",
        "Explicit human draw adjudication (browser rule)",
      );
    };
    $("tournament-export").onclick = () => {
      if (!this.event) return;
      downloadPgn(
        this.event.games.flatMap((g) => (g.pgn ? [g.pgn] : [])).join("\n\n"),
        "chessmaster-tournament.pgn",
      );
    };
  }
  async open(): Promise<void> {
    try {
      if (!this.profiles.length) {
        const r = await fetch("/assets/personalities.json");
        if (!r.ok) throw new Error(`Personality load ${r.status}`);
        const data = (await r.json()) as Profile[];
        if (
          !Array.isArray(data) ||
          data.some(
            (p) =>
              typeof p.id !== "string" ||
              typeof p.name !== "string" ||
              !p.parameters,
          )
        )
          throw new Error("Invalid personality data");
        this.profiles = data;
        const select = $<HTMLSelectElement>("tournament-players");
        for (const p of data) {
          const o = document.createElement("option");
          o.value = p.id;
          o.textContent = p.name;
          o.selected = ["aaron", "niko"].includes(p.id);
          select.append(o);
        }
      }
      if (!this.active) {
        const raw = localStorage.getItem(KEY);
        let candidate: EventData | undefined;
        if (raw) {
          candidate = validateEvent(JSON.parse(raw));
          for (const g of candidate.games)
            if (g.pgn) {
              const parsed = parsePgnGames(g.pgn);
              if (
                parsed.length !== 1 ||
                parsed[0].error ||
                parsed[0].headers.Result !== g.result
              )
                throw new Error("Stored fixture PGN is invalid");
            }
        }
        this.snapshot = raw;
        this.event = candidate;
      }
      this.loadFailed = false;
      this.render();
    } catch (error) {
      this.loadFailed = true;
      this.message(error);
    }
  }
  private name(id: string) {
    return id === "you"
      ? "You"
      : (this.profiles.find((p) => p.id === id)?.name ?? id);
  }
  private commit(next: EventData) {
    if (localStorage.getItem(KEY) !== this.snapshot)
      throw new Error(
        "Tournament changed in another tab; reopen before editing.",
      );
    const raw = JSON.stringify(next);
    localStorage.setItem(KEY, raw);
    this.snapshot = raw;
    this.event = next;
  }
  private create() {
    try {
      if (this.loadFailed)
        throw new Error(
          "Export recovery data and explicitly reset the corrupt/unsupported event first.",
        );
      if (this.active)
        throw new Error("Finish or cancel the active fixture first.");
      if (
        this.event?.games.some((g) => g.result) &&
        !confirm("Replace this local tournament? Export games first.")
      )
        return;
      const players = [
        ...$<HTMLSelectElement>("tournament-players").selectedOptions,
      ].map((o) => o.value);
      if ($<HTMLInputElement>("tournament-human").checked)
        players.unshift("you");
      const next: EventData = {
        schemaVersion: 1,
        players,
        games: fixtures(players),
        depth: Number($<HTMLSelectElement>("tournament-depth").value),
        plyLimit: Number($<HTMLInputElement>("tournament-limit").value),
      };
      validateEvent(next);
      this.commit(next);
      $("tournament-message").textContent =
        "Local event created. Start a fixture below.";
      this.render();
    } catch (error) {
      this.message(error);
    }
  }
  private render() {
    const event = this.event;
    const body = $("tournament-fixtures");
    body.replaceChildren();
    const table = $("tournament-standings");
    table.replaceChildren();
    $("tournament-banner").hidden = this.humanGeneration === undefined;
    $<HTMLButtonElement>("tournament-cancel").disabled = !this.active;
    for (const id of ["tournament-resign", "tournament-draw"])
      $<HTMLButtonElement>(id).disabled = this.humanGeneration === undefined;
    if (!event) return;
    for (const g of event.games) {
      const row = document.createElement("tr");
      for (const text of [
        this.name(g.white),
        this.name(g.black),
        g.result ?? (this.active === g.id ? "In progress" : "Not played"),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      const cell = document.createElement("td");
      const b = document.createElement("button");
      b.textContent = g.result ? "Replay" : "Start fixture";
      b.disabled = !g.result && !!this.active;
      b.onclick = () => {
        if (g.result && g.pgn) {
          document
            .querySelector(".workspace")!
            .classList.remove("tournament-mode");
          $("tournament-panel").hidden = true;
          void this.content.openCollection(
            parsePgnGames(g.pgn),
            "Tournament replay",
          );
        } else void this.start(g.id);
      };
      cell.append(b);
      row.append(cell);
      body.append(row);
    }
    for (const score of standings(event.players, event.games)) {
      const row = document.createElement("tr");
      for (const text of [
        this.name(score.id),
        String(score.played),
        String(score.wins),
        String(score.draws),
        String(score.losses),
        String(score.points),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = text;
        row.append(cell);
      }
      table.append(row);
    }
  }
  private humanColor(): Color {
    const game = this.event?.games.find((g) => g.id === this.active);
    return game?.white === "you" ? "w" : "b";
  }
  private async start(id: string) {
    if (this.active || !this.event || this.loadFailed) return;
    const g = this.event.games.find((g) => g.id === id)!;
    this.active = id;
    const serial = ++this.serial;
    try {
      if (g.white === "you" || g.black === "you") {
        const opponent = g.white === "you" ? g.black : g.white;
        this.humanGeneration = this.beginHuman(opponent, this.humanColor());
        $("tournament-banner-text").textContent =
          `Local tournament: ${this.name(g.white)} vs ${this.name(g.black)}. Return to Tournament for resignation/adjudication.`;
        this.render();
        return;
      }
      const white = this.profiles.find((p) => p.id === g.white),
        black = this.profiles.find((p) => p.id === g.black);
      if (!white || !black) throw new Error("Original personality unavailable");
      this.runner = new EngineMatch();
      this.render();
      $("tournament-message").textContent =
        "The original King engine is playing both selected personalities…";
      const result = await this.runner.play(
        white,
        black,
        this.event.depth,
        this.event.plyLimit,
        (pgn, plies) => {
          $("tournament-live").textContent = `${plies} plies played\n${pgn}`;
        },
      );
      if (serial !== this.serial) return;
      this.finish(result.result, result.pgn, result.reason);
    } catch (error) {
      if (serial === this.serial) {
        this.active = undefined;
        this.humanGeneration = undefined;
        this.runner = undefined;
        this.render();
        this.message(error);
      }
    }
  }
  private finish(result: Result, pgn: string, reason: string) {
    if (!this.event || !this.active) return;
    const copy = new Chess();
    copy.loadPgn(pgn);
    copy.setHeader("Result", result);
    const next = structuredClone(this.event);
    const g = next.games.find((g) => g.id === this.active)!;
    g.result = result;
    g.pgn = copy.pgn();
    g.reason = reason;
    const wasHuman = this.humanGeneration !== undefined;
    this.commit(next);
    this.active = undefined;
    this.humanGeneration = undefined;
    this.runner = undefined;
    this.render();
    if (wasHuman) this.stopHuman();
    $("tournament-message").textContent =
      `Result recorded: ${result}. ${reason}`;
  }
  private humanResult(result: Result, reason: string) {
    try {
      if (this.humanGeneration === undefined) return;
      this.finish(result, this.currentPgn(), reason);
    } catch (error) {
      this.message(error);
    }
  }
  observe(game: Chess, generation: number) {
    if (this.humanGeneration === undefined) return;
    if (generation !== this.humanGeneration) {
      this.cancel();
      $("tournament-message").textContent =
        "A different Game Room game was started. No tournament result recorded.";
      return;
    }
    if (game.isGameOver())
      this.humanResult(
        game.isCheckmate() ? (game.turn() === "w" ? "0-1" : "1-0") : "1/2-1/2",
        "Terminal legal chess position",
      );
  }
  cancel() {
    ++this.serial;
    this.runner?.cancel();
    this.runner = undefined;
    this.active = undefined;
    this.humanGeneration = undefined;
    this.render();
    $("tournament-message").textContent =
      "Fixture canceled; no result recorded.";
  }
  private message(error: unknown) {
    $("tournament-message").textContent =
      `Tournament error: ${String(error)}. No unverified result was recorded.`;
  }
}
