/** Original The King worker adapter for sequential computer fixtures. No replacement engine. */
import { Chess } from "chess.js";
import { RING_SIZE, sendCommand, engineMove } from "./protocol";
import type { Result } from "./tournament";
export type Profile = {
  id: string;
  name: string;
  parameters: Record<string, number>;
};
export class EngineMatch {
  private worker: Worker | undefined;
  private ring: SharedArrayBuffer | undefined;
  private pending: ((line: string) => void) | undefined;
  private rejected: ((error: Error) => void) | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private fail(message: string) {
    const reject = this.rejected;
    this.pending = undefined;
    this.rejected = undefined;
    clearTimeout(this.deadline);
    reject?.(new Error(message));
  }
  private wait(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pending = resolve;
      this.rejected = reject;
      this.deadline = setTimeout(
        () => this.fail("Original engine did not reply within 45 seconds"),
        45000,
      );
    });
  }
  private resolve(line: string) {
    clearTimeout(this.deadline);
    const done = this.pending;
    this.pending = undefined;
    this.rejected = undefined;
    done?.(line);
  }
  private command(text: string) {
    if (!this.ring) throw new Error("Original engine is unavailable");
    sendCommand(this.ring, text);
  }
  cancel(): void {
    this.fail("Computer fixture canceled; no result recorded.");
    this.worker?.terminate();
    this.worker = undefined;
    this.ring = undefined;
  }
  async play(
    white: Profile,
    black: Profile,
    depth: number,
    plyLimit: number,
    updated: (pgn: string, plies: number) => void,
  ): Promise<{ result: Result; pgn: string; reason: string }> {
    if (!crossOriginIsolated)
      throw new Error("Cross-origin isolation is required");
    this.ring = new SharedArrayBuffer(RING_SIZE);
    this.worker = new Worker("/engine-worker.js", { type: "module" });
    this.worker.onerror = (e) =>
      this.fail(e.message || "Original engine worker failed");
    this.worker.onmessage = (
      event: MessageEvent<{ type: string; line?: string; message?: string }>,
    ) => {
      const { type, line = "", message } = event.data;
      if (type === "error") this.fail(message ?? "Original engine failed");
      else if (type === "ready") this.resolve("ready");
      else if (
        type === "diagnostic" &&
        /guest trap|outside guest|unsupported|Aborted/i.test(line)
      )
        this.fail(line);
      else if (type === "line") {
        const move = engineMove(line);
        if (move) this.resolve(move);
        else if (/^Illegal move|^Error/i.test(line)) this.fail(line);
      }
    };
    const ready = this.wait();
    this.worker.postMessage({ ring: this.ring });
    const game = new Chess();
    try {
      await ready;
      this.command("xboard\nnew\nforce");
      game.setHeader("Event", "Local Chessmaster round robin");
      game.setHeader("White", white.name);
      game.setHeader("Black", black.name);
      let plies = 0;
      while (!game.isGameOver() && plies < plyLimit) {
        const profile = game.turn() === "w" ? white : black;
        const response = this.wait();
        const commands = [
          "force",
          `setboard ${game.fen()}`,
          "cm_parm default",
          "cm_parm tts=16777216",
          ...Object.entries(profile.parameters).map(
            ([k, v]) => `cm_parm ${k}=${v}`,
          ),
          `sd ${depth}`,
          "st 1",
          "go",
        ];
        this.command(commands.join("\n"));
        const move = await response;
        try {
          game.move({
            from: move.slice(0, 2),
            to: move.slice(2, 4),
            promotion: move[4],
          });
        } catch {
          throw new Error(`Original engine returned illegal move ${move}`);
        }
        updated(game.pgn(), ++plies);
      }
      const result: Result = game.isCheckmate()
        ? game.turn() === "w"
          ? "0-1"
          : "1-0"
        : "1/2-1/2";
      const reason = game.isGameOver()
        ? "Terminal legal chess position"
        : "Browser ply-limit adjudication (draw)";
      game.setHeader("Result", result);
      return { result, pgn: game.pgn(), reason };
    } finally {
      this.cancel();
    }
  }
}
