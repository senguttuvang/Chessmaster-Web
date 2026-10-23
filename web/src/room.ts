const image = (name: string, alt = "") =>
  `<img src="/assets/recovered/${name}.png" alt="${alt}">`;
const title = (name: string, id?: string) =>
  `<header class="panel-title">${image("window-icon")}<h2>${name}</h2><button class="window-close" ${id ? `data-close="${id}"` : ""} aria-label="Hide ${name}">${image("close")}</button></header>`;
export const room = `
<main class="game-room">
  <header class="app-title">${image("window-icon")}<h1>${image("wordmark", "Chessmaster 9000")}</h1><span id="connection">Starting The King…</span></header>
  <nav class="menubar" aria-label="Application menu">
    <details><summary>File</summary><div class="menu-popup"><button data-action="new-game">New Game</button><button data-action="load-position">Set Up Position…</button><button data-action="export">Save Game as PGN…</button></div></details>
    <details><summary>Edit</summary><div class="menu-popup"><button data-action="load-position">Set Up Position…</button><button data-action="export">Copy to PGN file…</button></div></details>
    <details><summary>Game</summary><div class="menu-popup"><button data-action="new-game">New Game</button><button data-action="settings">Choose Opponent…</button></div></details>
    <details><summary>Actions</summary><div class="menu-popup"><button data-action="flip">Rotate Board</button></div></details>
    <details><summary>Preferences</summary><div class="menu-popup"><button data-action="settings">Board and Game Settings…</button><button data-action="toggle-view">Switch 2D / True 3D</button></div></details>
    <details><summary>Windows</summary><div class="menu-popup"><button data-show="shortcuts">Shortcuts</button><button data-show="game-status">Game Status</button><button data-show="captured-window">Captured Pieces</button><button id="restore-windows">Restore Window Layout</button></div></details>
    <details><summary>Rooms</summary><div class="menu-popup"><button data-action="room-home">Home</button><button data-action="room-kids">Kids Room</button><button data-action="room-game">Game Room</button><button data-action="room-classroom">Classroom</button><button data-action="room-library">Library</button><button disabled>Other rooms · pending recovery</button></div></details>
    <details><summary>Help</summary><div class="menu-popup"><button data-action="about">About this Reconstruction…</button></div></details>
  </nav>
  <div class="room-body">
    <nav class="icon-rail" aria-label="Rooms">
      <button id="room-home" aria-label="Home">${image("lobby")}</button>
      <button id="room-game" aria-label="Game Room" aria-current="page">${image("game")}</button>
      ${[
        ["classroom", "Classroom"],
        ["tournament", "Tournament"],
        ["library", "Library"],
        ["kids", "Kids Room"],
        ["database", "Database"],
        ["live", "CM Live"],
      ]
        .map(
          ([name, label]) =>
            `<button ${["classroom", "library", "kids"].includes(name) ? `id="room-${name}" aria-label="${label}"` : `disabled title="${label} is not implemented" aria-label="${label} · not implemented"`}>${image(name)}</button>`,
        )
        .join("")}
    </nav>
    <div class="workspace" data-room="game">
      <section id="landing-panel" class="landing-panel" hidden>
        <header class="panel-title"><img src="/assets/recovered/window-icon.png" alt=""><h2 id="landing-title">Home</h2></header>
        <div id="home-content"><h2>Choose a room</h2><div class="room-choices">
          ${[
            ["game", "Game Room"],
            ["classroom", "Classroom"],
            ["library", "Library"],
            ["kids", "Kids Room"],
          ]
            .map(
              ([id, label]) =>
                `<button data-room-choice="${id}"><img src="/assets/recovered/${id === "kids" ? "kids" : id}.png" alt="">${label}</button>`,
            )
            .join("")}
        </div><p>Play with the original engine, follow original lessons, or explore annotated games.</p></div>
        <div id="kids-content" hidden><h2>Kids Room</h2><div class="kids-paths"><section><img class="path-art" src="/assets/rooms/learn-to-play.png" alt="Learn to Play"><h3>Learn the pieces</h3><p>Original beginner lessons and board exercises. Narration is unavailable.</p><label for="kids-lesson">Choose an original lesson</label><select id="kids-lesson"></select><button id="kids-learn">Open lesson</button></section><section><img class="path-art" src="/assets/rooms/play-a-game.png" alt="Play a Game"><h3>Play a friendly opponent</h3><p>Starts a new game with original personality settings. Historical ratings are not calibrated here.</p><button data-kids-profile="aaron">New game with Aaron</button><button data-kids-profile="niko">New game with Niko</button></section></div></div>
        <p id="landing-message" role="status"></p><p class="landing-note">Original artwork and text; browser navigation and layout reconstructed.</p>
      </section>
      <section id="content-panel" class="content-panel floating" hidden>
        <header class="panel-title"><img src="/assets/recovered/window-icon.png" alt=""><h2 id="content-title">Classroom</h2></header>
        <div class="content-body"><label for="content-search">Search original content</label><input id="content-search" type="search"><p id="content-count"></p>
        <label for="content-select">Choose a lesson or game</label><select id="content-select"></select><label id="lesson-step-label" for="lesson-step">Lesson step</label><select id="lesson-step"></select>
        <div class="replay-controls"><button id="replay-first" aria-label="First replay frame">|◀</button><button id="replay-previous" aria-label="Previous replay frame">◀</button><button id="replay-next" aria-label="Next replay frame">▶</button><button id="replay-last" aria-label="Last replay frame">▶|</button></div>
        <p id="content-progress" role="status"></p><button id="replay-auto">Play demonstration</button><button id="replay-step-end">Show complete step</button>
        <p id="content-text"></p><p id="content-cues"></p><p id="content-warning"></p>
        <section id="exercise" hidden><h3>Original exercise</h3><p id="exercise-prompt"></p><div id="exercise-choices"></div><form id="exercise-form"><label for="exercise-answer">Your answer (or select move squares)</label><input id="exercise-answer" autocomplete="off"><button>Check answer</button></form></section>
        <p id="content-feedback" role="status"></p><button id="play-replay">Play this position against The King</button><p class="content-source" id="content-source"></p><details><summary>Original source text</summary><pre id="content-raw"></pre></details></div>
      </section>
      <section class="board-area" aria-label="Play chess">
        <div class="board-stage" id="board-stage"><div id="board" role="group" aria-label="Chessboard"></div></div>
        <div class="board-controls"><button id="toggle-view">2D view</button><button id="flip">Rotate board</button><span id="move-count">Move 1</span></div>
        <p id="renderer-state" role="status">Loading recovered 3D set…</p>
        <p id="renderer-error" role="alert" hidden></p>
        <div class="game-status-message" id="status" role="status" aria-live="polite">Loading the original engine…</div>
      </section>
      <section id="shortcuts" class="floating shortcuts" aria-label="Shortcuts">
        ${title("Shortcuts", "shortcuts")}
        <div class="shortcut-actions"><button id="new-game" aria-label="New game">${image("new-game")}</button><button id="settings" aria-label="Game settings">${image("true3d")}</button></div>
      </section>
      <section id="game-status" class="floating game-status-window" aria-label="Game Status">
        ${title("Game Status", "game-status")}
        <div class="player"><div>${image("black-king")}<span id="top-player">The King</span></div><output class="clock" id="top-clock" aria-label="Top player elapsed time">0:00</output><span class="time-control">Elapsed · untimed game</span></div>
        <div class="history-controls"><button id="history-first" aria-label="First move">${image("first")}</button><button id="history-previous" aria-label="Previous move">${image("previous")}</button><span id="history-position">Live</span><button id="history-next" aria-label="Next move">${image("next")}</button><button id="history-last" aria-label="Latest move">${image("last")}</button></div>
        <div class="notation"><ol id="moves" aria-label="Game moves"></ol><p id="empty-moves">Select a piece, then its destination.</p></div>
        <div class="player"><div>${image("white-king")}<span id="bottom-player">You · White</span></div><output class="clock" id="bottom-clock" aria-label="Bottom player elapsed time">0:00</output><span class="time-control">Elapsed · untimed game</span></div>
        <p id="turn-note">Original Chessmaster engine</p>
      </section>
      <section id="captured-window" class="floating captured-window" aria-label="Captured Pieces">
        ${title("Captured Pieces", "captured-window")}
        <div id="captured-stage"></div><div id="captured" aria-label="Captured pieces"></div><p id="empty-captured">No pieces captured.</p>
      </section>
    </div>
  </div>
  <footer class="statusbar"><span id="engine-state">Engine loading</span><div><button id="load-position">Load position</button><button id="export">Save PGN</button><button id="about">About</button></div></footer>
</main>
<dialog id="settings-dialog"><h2>Game settings</h2><div class="settings-grid">
<label for="personality">Opponent</label><select id="personality"><option value="default">The King · Default</option></select>
<label for="side">You play</label><select id="side"><option value="w">White</option><option value="b">Black</option></select>
<label for="depth">Search depth</label><select id="depth"><option value="2">2 plies · Quick</option><option value="4">4 plies · Standard</option><option value="6">6 plies · Deeper</option></select>
<label for="board-material">Original board</label><select id="board-material"><option value="BoardWoodDark512">Dark Wood</option><option value="BoardWoodBurl512">Burl Wood</option><option value="BoardWoodMahogany512">Mahogany Wood</option></select></div>
<p>Opponent, side or depth changes start a new game.</p><div class="opponent-details"><img id="portrait" src="/assets/wk.png" alt="Opponent portrait"><strong id="opponent-name">The King</strong><p id="opponent-style">The original Chessmaster 9000 engine.</p></div><p id="profile-note">Original personality ratings are uncalibrated for this browser runtime.</p><button id="close-settings">Return to game</button></dialog>
<dialog id="promotion"><h2>Promote your pawn</h2><p>Choose a piece to complete your move.</p><div class="promotion-options"></div></dialog>
<dialog id="position-dialog"><h2>Load a chess position</h2><form id="position-form"><label for="fen">Position in FEN notation</label><textarea id="fen" rows="4" required spellcheck="false"></textarea><p id="position-error" role="alert"></p><button type="submit">Start from position</button><button id="cancel-position" type="button">Cancel</button></form></dialog>
<dialog id="about-dialog"><h2>Chessmaster 9000, reconstructed</h2><p>The King 3.23's original x86 instructions are translated into C and compiled to WebAssembly. The engine runs locally in your browser.</p><p>Original Staunton meshes, wood textures, font, rail artwork and window bitmaps are recovered from the installation. The browser layout, lighting, controls and elapsed clocks are reimplemented. Exact screenshot materials, reflections and original runtime behavior remain unverified.</p><p>Classroom and Library use recovered original lesson text and classic games. Other rooms, opening books, tablebases, rated games and narration are not integrated. Playing strength is unverified. Use Game settings to choose among three recovered board textures.</p><button id="close-about">Return to game</button></dialog>`;

/** Reimplemented browser menu/window behavior, independent of game state. */
export function wireRoomControls(): void {
  const $ = (id: string) => document.getElementById(id)!;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-action]",
  ))
    button.onclick = () => {
      document
        .querySelectorAll(".menubar details")
        .forEach((d) => d.removeAttribute("open"));
      $(button.dataset.action!).click();
    };
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-close]",
  ))
    button.onclick = () => {
      $(button.dataset.close!).hidden = true;
    };
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-show]",
  ))
    button.onclick = () => {
      $(button.dataset.show!).hidden = false;
      document
        .querySelectorAll(".menubar details")
        .forEach((d) => d.removeAttribute("open"));
    };
  $("restore-windows").onclick = () => {
    for (const id of ["shortcuts", "game-status", "captured-window"]) {
      $(id).hidden = false;
      $(id).style.removeProperty("transform");
      $(id).dataset.dx = "0";
      $(id).dataset.dy = "0";
    }
    document
      .querySelectorAll(".menubar details")
      .forEach((d) => d.removeAttribute("open"));
  };
  $("room-game").onclick = () =>
    $("board").querySelector<HTMLButtonElement>("button")?.focus();
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape")
      document
        .querySelectorAll(".menubar details")
        .forEach((d) => d.removeAttribute("open"));
  });
  document.addEventListener("click", (event) => {
    if (!(event.target as HTMLElement).closest(".menubar"))
      document
        .querySelectorAll(".menubar details")
        .forEach((d) => d.removeAttribute("open"));
  });
  for (const panel of document.querySelectorAll<HTMLElement>(".floating")) {
    const title = panel.querySelector<HTMLElement>(".panel-title")!;
    let drag: { x: number; y: number; dx: number; dy: number } | null = null;
    let dx = 0,
      dy = 0;
    title.onpointerdown = (event) => {
      if (
        (event.target as HTMLElement).closest("button") ||
        matchMedia("(max-width: 700px)").matches
      )
        return;
      dx = Number(panel.dataset.dx ?? 0);
      dy = Number(panel.dataset.dy ?? 0);
      const bounds = panel.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, dx, dy };
      panel.dataset.originX = String(bounds.left - dx);
      panel.dataset.originY = String(bounds.top - dy);
      title.setPointerCapture(event.pointerId);
    };
    title.onpointermove = (event) => {
      if (!drag) return;
      const bounds = panel.getBoundingClientRect();
      dx = Math.max(
        -Number(panel.dataset.originX),
        Math.min(
          innerWidth - bounds.width - Number(panel.dataset.originX),
          drag.dx + event.clientX - drag.x,
        ),
      );
      dy = Math.max(
        48 - Number(panel.dataset.originY),
        Math.min(
          innerHeight - 50 - Number(panel.dataset.originY),
          drag.dy + event.clientY - drag.y,
        ),
      );
      panel.style.transform = `translate(${dx}px,${dy}px)`;
      panel.dataset.dx = String(dx);
      panel.dataset.dy = String(dy);
    };
    title.onpointerup = () => {
      drag = null;
    };
    title.onlostpointercapture = () => {
      drag = null;
    };
  }
}
