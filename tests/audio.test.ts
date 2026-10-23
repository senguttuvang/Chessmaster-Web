import { expect, test } from "bun:test";
import { Chess } from "chess.js";
import { ClipQueue, moveSoundEvents, type ClipOutput } from "../web/src/audio";
import { lessonFrames, narrationReferences, parseExercise, type Lesson } from "../web/src/replay";

test("committed moves choose original event sounds including special and terminal positions", () => {
  const cases = [
    [undefined, "e4", ["WhiteMove"]],
    ["7k/8/8/8/8/1n6/P7/7K w - - 0 1", "axb3", ["Capture"]],
    ["7k/8/8/3pP3/8/8/8/7K w - d6 0 1", "exd6", ["Capture"]],
    ["r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "O-O", ["Castle"]],
    ["7k/P7/8/8/8/8/8/7K w - - 0 1", "a8=Q+", ["Promotion", "Check"]],
    ["7k/8/5KQ1/8/8/8/8/8 w - - 0 1", "Qg7#", ["WhiteMove", "Checkmate"]],
    ["7k/8/8/8/b7/8/1N6/7K w - - 0 1", "Nxa4", ["Capture", "Draw"]],
  ] as const;
  for (const [fen, san, expected] of cases) {
    const game = new Chess(fen);
    expect(moveSoundEvents(game.move(san), game)).toEqual([...expected]);
  }
  const game = new Chess(); game.move("e4");
  expect(moveSoundEvents(game.move("e5"), game)).toEqual(["BlackMove"]);
});

test("lesson cues occur once in source order and nested answers retain their own voices", () => {
  const lesson: Lesson = { id: "fixture", title: "", source: "", sha256: "", steps: [{number: 1, raw: "", tokens: [
    {kind: "text", text: "First."},
    {kind: "command", name: "W", argument: "one", raw: "{W:one}"},
    {kind: "text", text: "Second."},
    {kind: "command", name: "W", argument: "two", raw: "{W:two}"},
    {kind: "command", name: "Q", argument: "Prompt{W:prompt};Yes;Correct{W:cor};No;Try{W:wrong};1", raw: ""},
  ]}] };
  const frames = lessonFrames(lesson);
  expect(frames.flatMap(f => f.media)).toEqual(["one", "two", "prompt"]);
  expect(frames.find(f => f.exercise)?.exercise?.choices?.map(c => c.media)).toEqual([["cor"], ["wrong"]]);
  const exercise = parseExercise("E", "Question{W:q};answer;Correct{W:yes};Wrong{W:no}");
  expect(exercise.correctMedia).toEqual(["yes"]);
  expect(exercise.incorrectMedia).toEqual(["no"]);
  expect(narrationReferences("{Q:question{W:x};yes{W:y}}")).toEqual(["x", "y"]);
});

test("replacing/canceling queued audio suppresses stale clips and resolves active playback", async () => {
  const played: string[] = [], errors: string[] = [];
  let finish: (() => void) | undefined;
  const output: ClipOutput = { volume: 1,
    play: async (_url, id) => { played.push(id); await new Promise<void>(resolve => { finish = resolve; }); },
    stop: () => { finish?.(); finish = undefined; } };
  const queue = new ClipQueue(output, error => errors.push(error));
  const clip = (id: string) => ({id, url:"/audio/" + id, duration:1});
  const old = queue.enqueue(async () => [clip("old"), clip("stale")]);
  await new Promise(resolve => setTimeout(resolve, 0));
  const latest = queue.enqueue(async () => [clip("new")], true);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(played).toEqual(["old", "new"]);
  queue.stop();
  await Promise.all([old, latest]);
  expect(errors).toEqual([]);
  await queue.enqueue(async () => { throw new Error("missing original"); });
  expect(errors).toEqual(["Sound unavailable: Error: missing original"]);
});
