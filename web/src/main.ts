import { Chess, type Square, type PieceSymbol, type Color } from "chess.js";
import { Effect, Schema } from "effect";
import { engineMove, RING_SIZE, sendCommand } from "./protocol";
import "./style.css";

type Personality = {
  id: string;
  name: string;
  rating: number;
  style: string;
  biography: string;
  parameters: Record<string, number>;
};
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<main class="game-room">
  <header class="masthead"><div class="wordmark">Chessmaster <span>9000</span></div><span class="edition">Browser reconstruction</span></header>
  <div class="window">
    <div class="titlebar"><h1>Game Room</h1><span id="connection">Starting The King…</span></div>
    <nav class="menubar" aria-label="Game controls"><button id="new-game">New game</button><button id="load-position">Load position</button><button id="flip">Flip board</button><button id="export">Save PGN</button><button id="about">About this reconstruction</button></nav>
    <div class="workspace">
      <section class="board-area" aria-label="Play chess">
        <div class="player-strip"><span id="top-player">The King</span><span id="turn-note">Original Chessmaster engine</span></div>
        <div class="board-frame"><div class="files" aria-hidden="true"></div><div id="board" role="group" aria-label="Chessboard"></div><div class="files" aria-hidden="true"></div></div>
        <div class="player-strip bottom"><span id="bottom-player">You · White</span><span id="move-count">Move 1</span></div>
        <div class="game-status" id="status" role="status" aria-live="polite">Loading the original engine. Your game will be ready shortly.</div>
      </section>
      <aside class="sidebar">
        <section class="panel opponent"><h2>Opponent</h2><div class="opponent-heading"><img id="portrait" src="/assets/aaron.png" alt="Original Chessmaster character portrait"><div><strong id="opponent-name">The King</strong><p id="opponent-style">The original Chessmaster 9000 engine.</p></div></div><label for="personality">Personality</label><select id="personality"><option value="default">The King · Default</option></select><p class="profile-note" id="profile-note">Original personality settings. Historical ratings are not calibrated for this browser runtime.</p></section>
        <section class="panel"><h2>Game settings</h2><div class="settings"><label for="side">You play</label><select id="side"><option value="w">White</option><option value="b">Black</option></select><label for="depth">Search depth</label><select id="depth"><option value="2">2 plies · Quick</option><option value="4">4 plies · Standard</option><option value="6">6 plies · Deeper</option></select></div><p class="settings-note">Changing a setting starts a new game.</p></section>
        <section class="panel notation"><h2>Move list</h2><div class="notation-head" aria-hidden="true"><span>No.</span><span>White</span><span>Black</span></div><ol id="moves" aria-label="Game moves"></ol><p id="empty-moves">Select a piece, then its destination.</p></section>
      </aside>
    </div>
    <footer class="statusbar"><span id="engine-state">Engine loading</span><span>Original pieces & personalities · Reconstructed interface</span></footer>
  </div>
  <p class="project-note">A private preservation experiment. Game Room is playable; the original lessons, narration and 3D rooms are not implemented in this build.</p>
</main>
<dialog id="promotion"><h2>Promote your pawn</h2><p>Choose a piece to complete your move.</p><div class="promotion-options"></div></dialog>
<dialog id="position-dialog"><h2>Load a chess position</h2><form id="position-form"><label for="fen">Position in FEN notation</label><textarea id="fen" rows="4" required spellcheck="false"></textarea><p id="position-error" role="alert"></p><button type="submit">Start from position</button><button id="cancel-position" type="button">Cancel</button></form></dialog>
<dialog id="about-dialog"><h2>Chessmaster 9000, reconstructed</h2><p>The King 3.23's original x86 instructions are translated into C and compiled to WebAssembly. The engine runs locally in your browser.</p><p>The interface is reconstructed using original piece artwork and personality data. Opening books, tablebases, original Windows controls and narrated lessons are not yet integrated. Playing strength is unverified.</p><p><a href="https://github.com/senguttuvang/Chessmaster-Web" target="_blank" rel="noreferrer">Project source and recovery tools</a></p><button id="close-about">Return to game</button></dialog>`;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const board = $("board");
const game = new Chess();
let selected: Square | null = null,
  flipped = false,
  thinking = false,
  ready = false;
let worker: Worker | null = null,
  ring: SharedArrayBuffer | null = null,
  generation = 0;
let deadline: ReturnType<typeof setTimeout> | undefined;
let profiles: readonly Personality[] = [];
const pieceNames: Record<PieceSymbol, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
const status = (message: string) => {
  $("status").textContent = message;
};
const human = (): Color => $<HTMLSelectElement>("side").value as Color;
const opponent = () =>
  profiles.find((p) => p.id === $<HTMLSelectElement>("personality").value);
const engineName = () => opponent()?.name ?? "The King";
const command = (text: string) => {
  if (!ring) throw new Error("Engine is not ready");
  sendCommand(ring, text);
};

function fail(message: string): void {
  ready = false;
  thinking = false;
  clearTimeout(deadline);
  worker?.terminate();
  worker = null;
  ring = null;
  $("connection").textContent = "Engine unavailable";
  $("engine-state").textContent = "Engine stopped";
  status(`${message} Use New game to retry.`);
  render();
}

function positionText(): string {
  if (game.isCheckmate())
    return `Checkmate. ${game.turn() === human() ? engineName() : "You"} won.`;
  if (game.isStalemate()) return "Draw by stalemate.";
  if (game.isThreefoldRepetition()) return "Draw by threefold repetition.";
  if (game.isInsufficientMaterial()) return "Draw by insufficient material.";
  if (game.isDraw()) return "Draw.";
  if (thinking)
    return `${engineName()} is thinking${game.isCheck() ? " · Check" : ""}…`;
  return `${game.isCheck() ? "Check. " : ""}Your move. Select a piece, then its destination.`;
}

function render(): void {
  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const legal = selected
    ? game.moves({ square: selected, verbose: true }).map((m) => m.to)
    : [];
  const history = game.history({ verbose: true }),
    last = history.at(-1);
  board.replaceChildren();
  for (const rank of ranks)
    for (const file of files) {
      const square = `${file}${rank}` as Square,
        piece = game.get(square),
        button = document.createElement("button");
      button.className = `square ${(file.charCodeAt(0) - 97 + rank) % 2 ? "light" : "dark"}`;
      button.dataset.square = square;
      button.setAttribute(
        "aria-label",
        `${square}${piece ? ` ${piece.color === "w" ? "white" : "black"} ${pieceNames[piece.type]}` : " empty"}`,
      );
      button.setAttribute("aria-pressed", String(square === selected));
      if (square === last?.from || square === last?.to)
        button.classList.add("last-move");
      if (square === selected) button.classList.add("selected");
      if (legal.includes(square)) button.classList.add("legal");
      if (piece) {
        const image = document.createElement("img");
        image.className = "piece";
        image.alt = "";
        image.draggable = false;
        image.src = `/assets/${piece.color}${piece.type}.png`;
        button.append(image);
      }
      if (file === files[0]) {
        const label = document.createElement("span");
        label.className = "rank";
        label.textContent = String(rank);
        label.setAttribute("aria-hidden", "true");
        button.append(label);
      }
      button.addEventListener("click", () => choose(square));
      button.addEventListener("keydown", (event) => {
        const offset: Record<string, number> = {
          ArrowRight: 1,
          ArrowLeft: -1,
          ArrowUp: -8,
          ArrowDown: 8,
        };
        if (event.key in offset) {
          event.preventDefault();
          const buttons = [
            ...board.querySelectorAll<HTMLButtonElement>("button"),
          ];
          buttons[
            (buttons.indexOf(button) + offset[event.key] + 64) % 64
          ].focus();
        }
      });
      board.append(button);
    }
  document.querySelectorAll(".files").forEach((row) => {
    row.textContent = [...files].join(" ");
  });
  const humanText = `You · ${human() === "w" ? "White" : "Black"}`;
  $("top-player").textContent =
    flipped === (human() === "b") ? engineName() : humanText;
  $("bottom-player").textContent =
    flipped === (human() === "b") ? humanText : engineName();
  $("turn-note").textContent = thinking
    ? "Thinking…"
    : game.isGameOver()
      ? "Game complete"
      : "Original Chessmaster engine";
  $("move-count").textContent = `Move ${Math.floor(history.length / 2) + 1}`;
  const list = $("moves");
  list.replaceChildren();
  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement("li");
    for (const text of [
      `${i / 2 + 1}.`,
      history[i].san,
      history[i + 1]?.san ?? "—",
    ]) {
      const span = document.createElement("span");
      span.textContent = text;
      row.append(span);
    }
    list.append(row);
  }
  $("empty-moves").hidden = history.length > 0;
  list.scrollTop = list.scrollHeight;
}

async function choose(square: Square): Promise<void> {
  if (!ready || thinking || game.isGameOver() || game.turn() !== human())
    return;
  const piece = game.get(square);
  if (selected) {
    const candidates = game
      .moves({ square: selected, verbose: true })
      .filter((m) => m.to === square);
    if (candidates.length) {
      let promotion: PieceSymbol | undefined;
      if (candidates.some((m) => m.promotion)) promotion = await promote();
      const from = selected;
      selected = null;
      const move = game.move({ from, to: square, promotion });
      command("force\n" + move.from + move.to + (move.promotion ?? ""));
      if (!game.isGameOver()) {
        thinking = true;
        command("go");
        watchReply();
      }
      status(positionText());
      render();
      return;
    }
  }
  selected = piece?.color === human() && selected !== square ? square : null;
  render();
}

function promote(): Promise<PieceSymbol> {
  const dialog = $<HTMLDialogElement>("promotion"),
    options = dialog.querySelector(".promotion-options")!;
  return new Promise((resolve) => {
    options.replaceChildren();
    for (const piece of ["q", "r", "b", "n"] as PieceSymbol[]) {
      const button = document.createElement("button");
      button.textContent = pieceNames[piece];
      button.onclick = () => {
        dialog.close();
        resolve(piece);
      };
      options.append(button);
    }
    dialog.oncancel = (event) => event.preventDefault();
    dialog.showModal();
  });
}

function watchReply(): void {
  clearTimeout(deadline);
  deadline = setTimeout(
    () => fail("The engine did not reply within 45 seconds."),
    45000,
  );
}

async function startGame(fen?: string): Promise<void> {
  const current = ++generation;
  worker?.terminate();
  clearTimeout(deadline);
  if (fen) game.load(fen);
  else game.reset();
  selected = null;
  thinking = false;
  ready = false;
  ring = null;
  render();
  const profile = opponent();
  $("opponent-name").textContent = engineName();
  $("opponent-style").textContent =
    profile?.style || "The original Chessmaster 9000 engine.";
  $<HTMLImageElement>("portrait").src =
    `/assets/${profile?.id === "niko" ? "niko" : profile?.id === "aaron" ? "aaron" : "wk"}.png`;
  $("connection").textContent = "Starting The King…";
  $("engine-state").textContent = "Engine loading";
  status("Loading the original engine…");
  await Effect.runPromise(
    Effect.tryPromise({
      try: async () => {
        if (!crossOriginIsolated || typeof SharedArrayBuffer === "undefined")
          throw new Error(
            "This page needs cross-origin isolation. Start it with the project’s development server.",
          );
        ring = new SharedArrayBuffer(RING_SIZE);
        worker = new Worker("/engine-worker.js", { type: "module" });
        worker.onerror = (event) => {
          if (current === generation)
            fail(event.message || "The engine worker stopped.");
        };
        worker.onmessage = (
          event: MessageEvent<{
            type: string;
            line?: string;
            message?: string;
          }>,
        ) => {
          if (current !== generation) return;
          const { type, line = "", message } = event.data;
          if (type === "error") {
            fail(message ?? "Engine failed.");
            return;
          }
          if (type === "ready") {
            command(
              "xboard\nnew\nforce\ncm_parm default\ncm_parm tts=16777216",
            );
            if (profile)
              for (const [key, value] of Object.entries(profile.parameters))
                command(`cm_parm ${key}=${value}`);
            command(`sd ${$<HTMLSelectElement>("depth").value}\nst 2`);
            if (fen) command(`setboard ${fen}`);
            ready = true;
            $("connection").textContent = "The King · Ready";
            $("engine-state").textContent = "The King 3.23 · WebAssembly";
            if (game.turn() !== human() && !game.isGameOver()) {
              thinking = true;
              command("go");
              watchReply();
            }
            status(positionText());
            render();
          }
          if (
            type === "diagnostic" &&
            /guest trap|outside guest|unsupported|Invalid handle|Aborted/i.test(
              line,
            )
          )
            fail(line);
          if (type === "line") {
            const move = engineMove(line);
            if (move) {
              if (!thinking || game.turn() === human()) {
                fail("Unexpected engine move; the game state was not changed.");
                return;
              }
              try {
                game.move({
                  from: move.slice(0, 2),
                  to: move.slice(2, 4),
                  promotion: move[4],
                });
              } catch {
                fail(`The engine returned an illegal move: ${move}.`);
                return;
              }
              clearTimeout(deadline);
              thinking = false;
              status(positionText());
              render();
            }
            if (/^Illegal move|^Error/i.test(line)) fail(`Engine: ${line}`);
          }
        };
        worker.postMessage({ ring });
        deadline = setTimeout(() => {
          if (current === generation && !ready)
            fail("The engine could not start within 45 seconds.");
        }, 45000);
      },
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    }).pipe(Effect.catchAll((error) => Effect.sync(() => fail(error.message)))),
  );
}

$("new-game").onclick = () => void startGame();
$("load-position").onclick = () => {
  $<HTMLTextAreaElement>("fen").value = game.fen();
  $("position-error").textContent = "";
  $<HTMLDialogElement>("position-dialog").showModal();
};
$("cancel-position").onclick = () =>
  $<HTMLDialogElement>("position-dialog").close();
$("position-form").onsubmit = (event) => {
  event.preventDefault();
  const fen = $<HTMLTextAreaElement>("fen").value.trim();
  try {
    new Chess(fen);
  } catch (error) {
    $("position-error").textContent =
      error instanceof Error ? error.message : "Invalid position";
    return;
  }
  $<HTMLDialogElement>("position-dialog").close();
  void startGame(fen);
};
$("flip").onclick = () => {
  flipped = !flipped;
  render();
};
$("export").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([game.pgn() + "\n"], { type: "application/x-chess-pgn" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "chessmaster-game.pgn";
  a.click();
  URL.revokeObjectURL(url);
};
$("about").onclick = () => $<HTMLDialogElement>("about-dialog").showModal();
$("close-about").onclick = () => $<HTMLDialogElement>("about-dialog").close();
for (const id of ["side", "depth", "personality"])
  $(id).addEventListener("change", () => void startGame());
render();
const PersonalitySchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  rating: Schema.Number,
  style: Schema.String,
  biography: Schema.String,
  parameters: Schema.Record({ key: Schema.String, value: Schema.Number }),
});
fetch("/assets/personalities.json")
  .then(async (response) => {
    if (!response.ok) throw new Error("Personality data unavailable");
    return Schema.decodeUnknownSync(Schema.Array(PersonalitySchema))(
      await response.json(),
    );
  })
  .then((data) => {
    profiles = data;
    const select = $<HTMLSelectElement>("personality");
    for (const profile of profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.name;
      select.append(option);
    }
  })
  .catch((error) => {
    $("profile-note").textContent =
      `Personality data unavailable: ${String(error)}. The default engine is still available.`;
  });
void startGame();
