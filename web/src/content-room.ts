import { Chess } from "chess.js";
import { Schema } from "effect";
import {
  LessonsSchema,
  lessonFrames,
  diagram,
  placement,
  ReplayController,
  type Lesson,
  type Frame,
  type Diagram,
  type Exercise,
} from "./replay";
const GameSchema = Schema.Struct({
  id: Schema.String,
  headers: Schema.Record({ key: Schema.String, value: Schema.String }),
  pgn: Schema.String,
  error: Schema.NullOr(Schema.String),
  frames: Schema.Array(
    Schema.Struct({
      fen: Schema.String,
      san: Schema.String,
      comment: Schema.String,
    }),
  ),
});
const GamesSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  games: Schema.Array(GameSchema),
});
type Game = Schema.Schema.Type<typeof GameSchema>;
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export class ContentRoom {
  mode: "game" | "classroom" | "library" = "game";
  replay: ReplayController | undefined;
  private lessons: readonly Lesson[] = [];
  private games: readonly Game[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private selected = "";
  private override: Diagram | undefined;
  private from: string | null = null;
  private picked = new Set<string>();
  private request = 0;
  constructor(
    private changed: () => void,
    private play: (fen: string) => void,
  ) {
    $("content-search").oninput = () => this.catalog();
    $("content-select").onchange = () =>
      this.select($<HTMLSelectElement>("content-select").value);
    $("lesson-step").onchange = () => {
      this.stop();
      this.replay?.step(Number($<HTMLSelectElement>("lesson-step").value));
      this.update();
    };
    for (const [id, delta] of [
      ["replay-first", -Infinity],
      ["replay-previous", -1],
      ["replay-next", 1],
      ["replay-last", Infinity],
    ] as const)
      $(id).onclick = () => {
        this.stop();
        this.replay?.seek((this.replay?.index ?? 0) + delta);
        this.update();
      };
    $("replay-step-end").onclick = () => {
      this.stop();
      if (!this.replay) return;
      const step = this.replay.current.step;
      const indices = this.replay.frames.flatMap((f, i) =>
        f.step === step ? [i] : [],
      );
      this.replay.seek(indices.at(-1) ?? 0);
      this.update();
    };
    $("replay-auto").onclick = () => {
      if (this.timer) {
        this.stop();
        return;
      }
      this.timer = setInterval(() => {
        if (
          !this.replay ||
          this.replay.index === this.replay.frames.length - 1
        ) {
          this.stop();
          return;
        }
        this.replay.next();
        this.update();
      }, 900);
      $("replay-auto").textContent = "Pause";
    };
    $("exercise-form").onsubmit = (e) => {
      e.preventDefault();
      this.answer($<HTMLInputElement>("exercise-answer").value);
    };
    $("play-replay").onclick = () => {
      const f = this.current;
      if (!f) return;
      const fen = f.fen ?? `${placement(this.board!)} ${f.turn} - - 0 1`;
      try {
        new Chess(fen);
      } catch (error) {
        $("content-feedback").textContent =
          `This teaching diagram is not a legal playable position: ${String(error)}`;
        return;
      }
      this.open("game");
      this.play(fen);
    };
  }
  get active() {
    return this.mode !== "game";
  }
  get current() {
    return this.active ? this.replay?.current : undefined;
  }
  get board() {
    return this.override ?? this.current?.board;
  }
  async open(mode: "game" | "classroom" | "library"): Promise<void> {
    this.stop();
    this.mode = mode;
    this.replay = undefined;
    this.override = undefined;
    const request = ++this.request;
    document
      .querySelector(".workspace")!
      .classList.toggle("content-mode", this.active);
    document
      .querySelector(".workspace")!
      .classList.toggle("library-mode", mode === "library");
    $("content-panel").hidden = !this.active;
    for (const [id, name] of [
      ["room-game", "game"],
      ["room-classroom", "classroom"],
      ["room-library", "library"],
    ])
      $(id).setAttribute("aria-current", mode === name ? "page" : "false");
    $("content-title").textContent =
      mode === "classroom" ? "Classroom" : "Library";
    $("content-feedback").textContent = "";
    $("content-text").textContent = "";
    if (!this.active) {
      this.changed();
      return;
    }
    $("content-progress").textContent = "Loading original content…";
    try {
      if (mode === "classroom" && !this.lessons.length) {
        const response = await fetch("/content/lessons.json");
        if (!response.ok) throw new Error(`Lesson load ${response.status}`);
        this.lessons = Schema.decodeUnknownSync(LessonsSchema)(
          await response.json(),
        ).lessons as Lesson[];
      }
      if (mode === "library" && !this.games.length) {
        const response = await fetch("/content/games.json");
        if (!response.ok) throw new Error(`Game load ${response.status}`);
        this.games = Schema.decodeUnknownSync(GamesSchema)(
          await response.json(),
        ).games;
      }
      if (request !== this.request) return;
      $<HTMLInputElement>("content-search").value = "";
      this.catalog();
    } catch (error) {
      if (request === this.request) {
        $("content-progress").textContent = "Content unavailable";
        $("content-feedback").textContent =
          `${String(error)}. Reopen the room to retry.`;
      }
    }
    this.changed();
  }
  private catalog(): void {
    const query = $<HTMLInputElement>("content-search").value.toLowerCase();
    const select = $<HTMLSelectElement>("content-select");
    select.replaceChildren();
    const items =
      this.mode === "classroom"
        ? this.lessons.map((l) => ({ id: l.id, title: l.title }))
        : this.games.map((g) => ({
            id: g.id,
            title: `${g.headers.White} — ${g.headers.Black} · ${g.headers.Date} · ${g.headers.Result}`,
          }));
    for (const item of items.filter((i) =>
      i.title.toLowerCase().includes(query),
    )) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.title;
      select.append(option);
    }
    if ([...select.options].some((o) => o.value === this.selected))
      select.value = this.selected;
    $("content-count").textContent =
      `${select.options.length} of ${items.length} ${this.mode === "classroom" ? "lessons" : "games"}`;
    if (select.value) this.select(select.value);
    else {
      this.replay = undefined;
      $("content-text").textContent = "No matching content.";
      $("content-progress").textContent = "No selection";
      this.changed();
    }
  }
  private select(id: string): void {
    this.stop();
    this.selected = id;
    $("content-feedback").textContent = "";
    const step = $<HTMLSelectElement>("lesson-step");
    step.replaceChildren();
    step.hidden = this.mode !== "classroom";
    if (this.mode === "classroom") {
      const lesson = this.lessons.find((l) => l.id === id)!;
      this.replay = new ReplayController(lessonFrames(lesson));
      lesson.steps.forEach((s, i) => {
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = `${i + 1}. Source step ${s.number}`;
        step.append(o);
      });
      $("content-source").textContent =
        `${lesson.source} · SHA-256 ${lesson.sha256} · Original text; narration unavailable`;
    } else {
      const game = this.games.find((g) => g.id === id)!;
      if (game.error) {
        this.replay = undefined;
        $("content-feedback").textContent = game.error;
        return;
      }
      this.replay = new ReplayController(
        game.frames.map((f, i) => ({
          ...diagram(
            f.fen
              .split(" ")
              .slice(0, 2)
              .join(" ")
              .replace(/ w$/, " WHITE")
              .replace(/ b$/, " BLACK"),
          ),
          text: f.comment,
          highlights: [],
          arrows: [],
          step: i,
          warnings: [],
          media: [],
          flipped: false,
          fen: f.fen,
          san: f.san,
        })),
      );
      $("content-source").textContent =
        `CLASSICG.PGN · ${game.headers.Site ?? ""} · ${game.headers.Event ?? ""} · Original game and comments`;
    }
    this.update();
  }
  private update(): void {
    this.override = undefined;
    this.from = null;
    this.picked.clear();
    $("content-feedback").textContent = "";
    const frame = this.current;
    if (!frame) {
      this.changed();
      return;
    }
    $("content-raw").textContent =
      this.mode === "classroom"
        ? (this.lessons.find((l) => l.id === this.selected)?.steps[frame.step]
            ?.raw ?? "")
        : (this.games.find((g) => g.id === this.selected)?.pgn ?? "");
    $("content-text").textContent =
      frame.text || "Use Next to follow the original demonstration.";
    $("content-progress").textContent =
      `${this.replay!.index + 1} / ${this.replay!.frames.length}${frame.san ? " · " + frame.san : ""}`;
    $<HTMLSelectElement>("lesson-step").value = String(frame.step);
    $("content-warning").textContent = [...new Set(frame.warnings)].join("\n");
    $("content-cues").textContent = frame.arrows.length
      ? `Original arrows: ${frame.arrows.join(", ")}`
      : "";
    const exercise = frame.exercise;
    $("exercise").hidden = !exercise;
    $("exercise-prompt").textContent = exercise?.prompt ?? "";
    const choices = $("exercise-choices");
    choices.replaceChildren();
    if (exercise?.choices)
      for (const choice of exercise.choices) {
        const b = document.createElement("button");
        b.textContent = choice.label;
        b.onclick = () => {
          $("content-feedback").textContent =
            choice.feedback +
            (choice.sourceScore
              ? ` (Original score: ${choice.sourceScore})`
              : "");
        };
        choices.append(b);
      }
    $("exercise-form").hidden = !!exercise?.choices;
    $<HTMLInputElement>("exercise-answer").value = "";
    this.changed();
  }
  choose(square: string): void {
    const ex = this.current?.exercise;
    if (!ex || !["V", "VB", "I"].includes(ex.kind)) return;
    if (ex.kind === "I") {
      const expected = ex.answer?.match(/[a-h][1-8]/g) ?? [];
      if (expected.length > 1) {
        if (this.picked.has(square)) this.picked.delete(square);
        else this.picked.add(square);
        if (this.picked.size === expected.length)
          this.answer([...this.picked].sort().join(""));
        else
          $("content-feedback").textContent =
            `Selected ${[...this.picked].join(", ")}. Choose ${expected.length} squares.`;
      } else this.answer(square);
      return;
    }
    if (!this.from) {
      this.from = square;
      $("content-feedback").textContent =
        `${square} selected. Choose the destination.`;
      return;
    }
    this.answer(this.from + square);
    this.from = null;
  }
  private answer(answer: string): void {
    const ex = this.current?.exercise;
    if (!ex) return;
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[\s.!]/g, "")
        .replace(/0/g, "o");
    const correct =
      (ex.kind === "I"
        ? (answer.match(/[a-h][1-8]/g) ?? []).sort().join("")
        : normalize(answer)) ===
      (ex.kind === "I"
        ? (ex.answer?.match(/[a-h][1-8]/g) ?? []).sort().join("")
        : normalize(ex.answer ?? ""));
    $("content-feedback").textContent = correct
      ? ex.correctFeedback || "Correct according to the lesson answer."
      : ex.incorrectFeedback ||
        "This differs from the original lesson answer. Try again.";
    if (
      correct &&
      ["V", "VB"].includes(ex.kind) &&
      /^[a-h][1-8][a-h][1-8]$/.test(answer)
    ) {
      const next = { ...this.board };
      next[answer.slice(2)] = next[answer.slice(0, 2)];
      delete next[answer.slice(0, 2)];
      this.override = next;
      this.changed();
    }
  }
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    $("replay-auto").textContent = "Play demonstration";
  }
}
