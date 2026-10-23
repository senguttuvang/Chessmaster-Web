import { expect, test } from "bun:test";
import { Chess } from "chess.js";
import { engineMove } from "../web/src/protocol";

test("original translated engine plays several legal replies and quits", async () => {
  const proc = Bun.spawn(["build/theking", "vendor/original/THEKING.EXE"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader(),
    decoder = new TextDecoder();
  let pending = "";
  async function line(): Promise<string> {
    for (;;) {
      const end = pending.indexOf("\n");
      if (end >= 0) {
        const s = pending.slice(0, end).trim();
        pending = pending.slice(end + 1);
        return s;
      }
      const data = await reader.read();
      if (data.done) throw new Error("Engine exited before reply");
      pending += decoder.decode(data.value, { stream: true });
    }
  }
  function send(command: string) {
    proc.stdin.write(command + "\n");
    proc.stdin.flush();
  }
  try {
    expect(await line()).toBe("__CM_ENGINE_READY__");
    send("xboard\nnew\nforce\ncm_parm tts=16777216\nsd 2\nst 1");
    const game = new Chess();
    for (let turn = 0; turn < 3; turn++) {
      const move = turn === 0 ? game.move("e4") : game.move(game.moves()[0]);
      send(`force\n${move.from}${move.to}${move.promotion ?? ""}\ngo`);
      let reply: string | null = null;
      for (let i = 0; i < 50 && !reply; i++) reply = engineMove(await line());
      expect(reply).not.toBeNull();
      game.move({
        from: reply!.slice(0, 2),
        to: reply!.slice(2, 4),
        promotion: reply![4],
      });
      expect(game.turn()).toBe("w");
    }
    expect(game.history()).toHaveLength(6);
    send("quit");
    expect(await proc.exited).toBe(0);
  } finally {
    proc.kill();
    reader.releaseLock();
  }
}, 20000);
