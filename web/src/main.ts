import { Chess, type Square, type PieceSymbol, type Color } from "chess.js";
import { Effect, Schema } from "effect";
import { engineMove, RING_SIZE, sendCommand } from "./protocol";
import "./style.css";
import { DatabaseRoom } from "./database-room";
import { RoomNavigation } from "./navigation";
import { ContentRoom } from "./content-room";
import { room, wireRoomControls } from "./room";
import { OriginalBoard, type CapturedPiece } from "./board3d";

type Personality = {
  id: string;
  name: string;
  rating: number;
  style: string;
  biography: string;
  parameters: Record<string, number>;
};
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = room;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const board = $("board");
const game = new Chess();
let originalBoard: OriginalBoard | undefined;
let contentRoom: ContentRoom | undefined;
let navigation: RoomNavigation | undefined;
let view3d = true;
let reviewPly: number | null = null;
let elapsed = { w: 0, b: 0 };
let clockTick = performance.now();
function rendererError(message: string): void {
  $("renderer-error").hidden = false;
  $("renderer-error").textContent = message + " Use 2D view to continue.";
  $("renderer-state").textContent = "3D unavailable";
}
function setView(): void {
  $("board-stage").classList.toggle("mode-3d", view3d);
  $("captured-window").classList.toggle("mode-3d", view3d && !!originalBoard);
  $("toggle-view").textContent = view3d ? "2D view" : "True 3D view";
  originalBoard?.setActive(view3d);
  $("renderer-state").textContent = view3d
    ? originalBoard
      ? "Staunton Rosewood & Ash · original 3D set"
      : "3D loading or unavailable"
    : "Original 2D piece artwork";
  render();
}
function capturedPieces(ply = game.history().length): CapturedPiece[] {
  return game
    .history({ verbose: true })
    .slice(0, ply)
    .filter((m) => m.captured)
    .map((m) => ({ type: m.captured!, color: m.color === "w" ? "b" : "w" }));
}
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
  const display =
    reviewPly === null
      ? game
      : new Chess(
          reviewPly === 0
            ? (game.history({ verbose: true })[0]?.before ?? game.fen())
            : game.history({ verbose: true })[reviewPly - 1].after,
        );
  const displayFlipped = contentRoom?.current?.flipped ? !flipped : flipped;
  const files = displayFlipped ? "hgfedcba" : "abcdefgh";
  const ranks = displayFlipped
    ? [1, 2, 3, 4, 5, 6, 7, 8]
    : [8, 7, 6, 5, 4, 3, 2, 1];
  const legal =
    reviewPly === null && selected
      ? game.moves({ square: selected, verbose: true }).map((m) => m.to)
      : [];
  const history = game.history({ verbose: true }),
    last = history.at(-1);
  board.replaceChildren();
  for (const rank of ranks)
    for (const file of files) {
      const square = `${file}${rank}` as Square,
        piece =
          contentPiece(square) ??
          (contentRoom?.active ? undefined : display.get(square)),
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
      if (contentRoom?.current?.highlights.includes(square))
        button.classList.add("selected");
      if (!contentRoom?.active && legal.includes(square))
        button.classList.add("legal");
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
  $("move-count").textContent = `Move ${game.moveNumber()}`;
  const list = $("moves");
  list.replaceChildren();
  const rows = new Map<number, { w?: string; b?: string }>();
  for (const move of history) {
    const number = new Chess(move.before).moveNumber();
    const row = rows.get(number) ?? {};
    row[move.color] = move.san;
    rows.set(number, row);
  }
  for (const [number, moves] of rows) {
    const row = document.createElement("li");
    for (const text of [`${number}.`, moves.w ?? "…", moves.b ?? "—"]) {
      const span = document.createElement("span");
      span.textContent = text;
      row.append(span);
    }
    list.append(row);
  }
  $("empty-moves").hidden = history.length > 0;
  list.scrollTop = list.scrollHeight;
  const pieces = [
    ...board.querySelectorAll<HTMLButtonElement>("[data-square]"),
  ].flatMap((button) => {
    const piece =
      contentPiece(button.dataset.square!) ??
      (contentRoom?.active
        ? undefined
        : display.get(button.dataset.square as Square));
    return piece
      ? [
          {
            square: button.dataset.square!,
            type: piece.type,
            color: piece.color,
          },
        ]
      : [];
  });
  const captured = contentRoom?.active
    ? []
    : capturedPieces(reviewPly ?? history.length);
  $("captured").replaceChildren(
    ...captured.map((piece) => {
      const img = document.createElement("img");
      img.src = `/assets/${piece.color}${piece.type}.png`;
      img.alt = `${piece.color === "w" ? "White" : "Black"} ${pieceNames[piece.type as PieceSymbol]}`;
      return img;
    }),
  );
  $("empty-captured").hidden = captured.length > 0;
  $("history-position").textContent =
    reviewPly === null ? "Live" : `${reviewPly}/${history.length}`;
  for (const id of ["history-first", "history-previous"])
    $<HTMLButtonElement>(id).disabled = (reviewPly ?? history.length) === 0;
  for (const id of ["history-last", "history-next"])
    $<HTMLButtonElement>(id).disabled = reviewPly === null;
  $("board-stage").classList.toggle("reviewing", reviewPly !== null);
  originalBoard?.update(pieces, displayFlipped, captured);
  if (contentRoom?.active) {
    $("status").textContent =
      `${contentRoom.mode === "classroom" ? "Classroom" : contentRoom.mode === "database" ? "Database" : "Library"} replay. Use the replay controls or answer the original exercise.`;
    $("move-count").textContent = "Replay";
  }
  updateClocks();
}

async function choose(square: Square): Promise<void> {
  if (contentRoom?.active) {
    contentRoom.choose(square);
    return;
  }
  if (
    reviewPly !== null ||
    !ready ||
    thinking ||
    game.isGameOver() ||
    game.turn() !== human()
  )
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
      updateClocks();
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
  reviewPly = null;
  elapsed = { w: 0, b: 0 };
  clockTick = performance.now();
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
                updateClocks();
                game.move({
                  from: move.slice(0, 2),
                  to: move.slice(2, 4),
                  promotion: move[4],
                });
              } catch {
                fail(`The engine returned an illegal move: ${move}.`);
                return;
              }
              reviewPly = null;
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

function updateClocks(): void {
  const now = performance.now(),
    delta = now - clockTick;
  clockTick = now;
  if (ready && !game.isGameOver()) elapsed[game.turn()] += delta;
  const topColor = flipped ? "w" : "b";
  for (const [id, color] of [
    ["top-clock", topColor],
    ["bottom-clock", topColor === "w" ? "b" : "w"],
  ] as const) {
    const seconds = Math.floor(elapsed[color] / 1000);
    $(id).textContent =
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  }
}
setInterval(updateClocks, 250);
$("settings").onclick = () =>
  $<HTMLDialogElement>("settings-dialog").showModal();
$("close-settings").onclick = () =>
  $<HTMLDialogElement>("settings-dialog").close();
$("toggle-view").onclick = () => {
  view3d = !view3d;
  setView();
};
$("board-material").onchange = () =>
  originalBoard?.setMaterial($<HTMLSelectElement>("board-material").value);
for (const [id, step] of [
  ["history-first", -Infinity],
  ["history-previous", -1],
  ["history-next", 1],
  ["history-last", Infinity],
] as const)
  $(id).onclick = () => {
    const next = Math.max(
      0,
      Math.min(
        game.history().length,
        (reviewPly ?? game.history().length) + step,
      ),
    );
    reviewPly = next === game.history().length ? null : next;
    selected = null;
    render();
  };
function contentPiece(square: string) {
  const char = contentRoom?.board?.[square];
  return char
    ? {
        type: char.toLowerCase() as PieceSymbol,
        color: (char === char.toUpperCase() ? "w" : "b") as Color,
      }
    : undefined;
}
wireRoomControls();
contentRoom = new ContentRoom(render, (fen) => {
  navigation?.show("game");
  void startGame(fen);
});
const databaseRoom = new DatabaseRoom(contentRoom, () => game.pgn());
navigation = new RoomNavigation(
  contentRoom,
  (id) => {
    const select = $<HTMLSelectElement>("personality");
    if (![...select.options].some((o) => o.value === id)) {
      status(
        "Personality data is not ready. Wait for loading or reopen Game settings.",
      );
      return;
    }
    select.value = id;
    select.dispatchEvent(new Event("change"));
  },
  () => databaseRoom.open(),
);
OriginalBoard.create(
  $("board-stage"),
  board,
  $("captured-stage"),
  rendererError,
)
  .then((view) => {
    originalBoard = view;
    view.setMaterial($<HTMLSelectElement>("board-material").value);
    setView();
  })
  .catch((error) =>
    rendererError(`Recovered 3D set could not load: ${String(error)}`),
  );
setView();
$("new-game").onclick = () => {
  navigation?.show("game");
  void startGame();
};
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
  navigation?.show("game");
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
  $(id).addEventListener("change", () => {
    $<HTMLDialogElement>("settings-dialog").close();
    void startGame();
  });
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
