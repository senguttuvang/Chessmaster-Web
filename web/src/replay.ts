/** Original content interpretation; diagrams are intentionally independent of legal chess. */
import { Schema } from "effect";
export type Diagram = Record<string, string>;
export type Token =
  | { kind: "text"; text: string }
  | { kind: "command"; name: string; argument: string; raw: string };
export type Lesson = {
  id: string;
  title: string;
  source: string;
  sha256: string;
  steps: { number: number; tokens: Token[]; raw: string }[];
};
export type Choice = {
  label: string;
  feedback: string;
  correct: boolean;
  sourceScore?: string;
};
export type Exercise = {
  kind: string;
  prompt: string;
  answer?: string;
  correctFeedback?: string;
  incorrectFeedback?: string;
  choices?: Choice[];
};
export type Frame = {
  board: Diagram;
  turn: "w" | "b";
  flipped: boolean;
  text: string;
  highlights: string[];
  arrows: string[];
  step: number;
  exercise?: Exercise;
  warnings: string[];
  media: string[];
  fen?: string;
  san?: string;
};
const TokenSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("command"),
    name: Schema.String,
    argument: Schema.String,
    raw: Schema.String,
  }),
);
export const LessonsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  lessons: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      source: Schema.String,
      sha256: Schema.String,
      steps: Schema.Array(
        Schema.Struct({
          number: Schema.Number,
          tokens: Schema.Array(TokenSchema),
          raw: Schema.String,
        }),
      ),
    }),
  ),
});
export function fields(text: string): string[] {
  let depth = 0,
    start = 0;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (text[i] === ";" && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((s) => s.trim());
}
export function plain(text: string): string {
  let depth = 0;
  let out = "";
  for (const c of text) {
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0) out += c;
  }
  return out.replace(/\s+/g, " ").trim();
}
export function diagram(input: string): { board: Diagram; turn: "w" | "b" } {
  const [position, side] = input.trim().split(/\s+/);
  const flat: string[] = [];
  for (const m of position.matchAll(/[prnbqkPRNBQK]|\d+|[^/]/g)) {
    if (/^\d+$/.test(m[0])) flat.push(...Array(Number(m[0])).fill(""));
    else if (/^[prnbqkPRNBQK]$/.test(m[0])) flat.push(m[0]);
    else throw new Error(`Unsupported board symbol ${m[0]}`);
  }
  if (flat.length !== 64)
    throw new Error(`Diagram has ${flat.length} squares, expected 64`);
  return {
    board: Object.fromEntries(
      flat.flatMap((p, i) =>
        p ? [[`${"abcdefgh"[i % 8]}${8 - Math.floor(i / 8)}`, p]] : [],
      ),
    ),
    turn: side === "BLACK" ? "b" : "w",
  };
}
export function placement(board: Diagram): string {
  return Array.from({ length: 8 }, (_, r) => {
    let row = "",
      empty = 0;
    for (const f of "abcdefgh") {
      const p = board[`${f}${8 - r}`];
      if (p) {
        if (empty) row += empty;
        empty = 0;
        row += p;
      } else empty++;
    }
    if (empty) row += empty;
    return row;
  }).join("/");
}
export function parseExercise(name: string, arg: string): Exercise {
  const p = fields(arg);
  const ex: Exercise = { kind: name, prompt: plain(p[0] ?? "") };
  if (name === "Q" || name === "QB") {
    const last = p.at(-1)!;
    const correctIndex = /^\d+$/.test(last) ? Number(last) - 1 : null;
    const end = correctIndex === null ? p.length : p.length - 1;
    ex.choices = [];
    for (let i = 1; i + 1 < end; i += 2)
      ex.choices.push({
        label: plain(p[i]),
        feedback: plain(p[i + 1]),
        correct:
          correctIndex === null
            ? /^(Correct|That's right|Yes[,!.])/i.test(plain(p[i + 1]))
            : (i - 1) / 2 === correctIndex,
      });
  } else if (name === "QM") {
    ex.choices = p
      .slice(1)
      .filter(Boolean)
      .map((option) => {
        const match = option.match(/^([^:]+):([\s\S]*?)(?::(-?\d+))?$/);
        return {
          label: plain(match?.[1] ?? option),
          feedback: plain(match?.[2] ?? "Original answer format unavailable"),
          correct: /^Correct[.!]/i.test(plain(match?.[2] ?? "")),
          sourceScore: match?.[3],
        };
      });
  } else {
    ex.answer = plain(p[1] ?? "");
    ex.correctFeedback = plain(p[2] ?? "");
    ex.incorrectFeedback = plain(p[3] ?? "");
  }
  return ex;
}
export function lessonFrames(lesson: Lesson): Frame[] {
  const frames: Frame[] = [];
  let state: Frame = {
    board: {},
    turn: "w",
    flipped: false,
    text: "",
    highlights: [],
    arrows: [],
    step: 0,
    warnings: [],
    media: [],
  };
  const push = () => frames.push(structuredClone(state));
  for (let index = 0; index < lesson.steps.length; index++) {
    const step = lesson.steps[index];
    state = {
      ...state,
      step: index,
      text: "",
      exercise: undefined,
      warnings: [],
      media: [],
    };
    push();
    for (const t of step.tokens) {
      try {
        if (t.kind === "text") {
          if (t.text.trim()) {
            state.text += (state.text ? " " : "") + t.text.trim();
            push();
          }
          continue;
        }
        const a = t.argument;
        if (t.name === "B") {
          const d = diagram(a);
          state.board = d.board;
          if (/\b(WHITE|BLACK)\b/.test(a)) state.turn = d.turn;
          state.highlights = [];
          state.arrows = [];
          push();
        } else if (t.name === "P") {
          const m = a.match(/^([WB])([KQRBNP])([a-h][1-8])$/);
          if (!m) throw new Error(`Unsupported piece placement ${a}`);
          state.board[m[3]] = m[1] === "W" ? m[2] : m[2].toLowerCase();
          push();
        } else if (t.name === "X") {
          for (const sq of a.match(/[a-h][1-8]/g) ?? []) delete state.board[sq];
          push();
        } else if (t.name === "S") {
          const m = a.match(/^([a-h][1-8])([a-h][1-8])$/);
          if (!m || !state.board[m[1]])
            throw new Error(`Scripted move cannot be applied: ${a}`);
          state.board[m[2]] = state.board[m[1]];
          delete state.board[m[1]];
          state.turn =
            state.board[m[2]] === state.board[m[2]].toUpperCase() ? "b" : "w";
          state.highlights = [m[1], m[2]];
          push();
        } else if (t.name === "F") {
          state.flipped = a === "B";
          push();
        } else if (["H", "H1", "H2", "N", "N1"].includes(t.name)) {
          state.highlights = a.match(/[a-h][1-8]/g) ?? [];
          push();
        } else if (t.name === "A" || t.name === "AB") {
          state.arrows.push(a);
          push();
        } else if (t.name === "C") {
          state.highlights = [];
          push();
        } else if (t.name === "R") {
          state.arrows = [];
          push();
        } else if (t.name === "W") {
          state.media.push(a);
        } else if (["Q", "QB", "QM", "E", "V", "VB", "I"].includes(t.name)) {
          // Prompt-local diagrams/moves precede the answer boundary. Preserve the
          // whole directive while replaying its prompt's nested display commands.
          const prompt = fields(a)[0];
          const nested = [...prompt.matchAll(/\{([^{}:]+):([^{}]*)\}/g)];
          for (const n of nested) {
            if (n[1] === "B") {
              state.board = diagram(n[2]).board;
            }
            if (n[1] === "S") {
              const m = n[2].match(/^([a-h][1-8])([a-h][1-8])$/);
              if (m && state.board[m[1]]) {
                state.board[m[2]] = state.board[m[1]];
                delete state.board[m[1]];
              }
            }
          }
          state.exercise = parseExercise(t.name, a);
          push();
        } else if (t.name !== "D") {
          state.warnings.push(`Unimplemented source directive: ${t.name}:${a}`);
          push();
        }
      } catch (error) {
        state.warnings.push(String(error));
        push();
      }
    }
  }
  return frames;
}
export class ReplayController {
  index = 0;
  constructor(public readonly frames: Frame[]) {
    if (!frames.length) throw new Error("No replay frames");
  }
  get current(): Frame {
    return this.frames[this.index];
  }
  seek(index: number): void {
    this.index = Math.max(0, Math.min(this.frames.length - 1, index));
  }
  next(): void {
    this.seek(this.index + 1);
  }
  previous(): void {
    this.seek(this.index - 1);
  }
  step(index: number): void {
    const frame = this.frames.findIndex((f) => f.step === index);
    if (frame >= 0) this.seek(frame);
  }
}
