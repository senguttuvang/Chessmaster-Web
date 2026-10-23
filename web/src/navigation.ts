import type { ContentRoom } from "./content-room";
export type RoomName =
  "home" | "game" | "classroom" | "library" | "kids" | "database";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
export class RoomNavigation {
  current: RoomName = "game";
  constructor(
    private content: ContentRoom,
    private profile: (id: string) => void,
    private database: () => void,
  ) {
    for (const room of [
      "home",
      "game",
      "classroom",
      "library",
      "kids",
      "database",
    ] as const)
      $(`room-${room}`).onclick = () => this.show(room);
    for (const b of document.querySelectorAll<HTMLButtonElement>(
      "[data-room-choice]",
    ))
      b.onclick = () => this.show(b.dataset.roomChoice as RoomName);
    for (const b of document.querySelectorAll<HTMLButtonElement>(
      "[data-kids-profile]",
    ))
      b.onclick = () => {
        this.show("game");
        this.profile(b.dataset.kidsProfile!);
      };
    $("kids-learn").onclick = () => {
      const id = $<HTMLSelectElement>("kids-lesson").value;
      if (!id) {
        $("landing-message").textContent =
          "Beginner lessons are unavailable. Reopen Kids Room to retry.";
        return;
      }
      this.show("classroom", id);
    };
  }
  show(room: RoomName, lessonId?: string): void {
    this.current = room;
    const landing = room === "home" || room === "kids";
    const workspace = document.querySelector<HTMLElement>(".workspace")!;
    workspace.dataset.room = room;
    workspace.classList.toggle("landing-mode", landing);
    $("landing-panel").hidden = !landing;
    $("home-content").hidden = room !== "home";
    $("kids-content").hidden = room !== "kids";
    $("landing-title").textContent = room === "kids" ? "Kids Room" : "Home";
    $("landing-message").textContent = "";
    if (room === "database") this.database();
    else if (lessonId) void this.content.openLesson(lessonId);
    else
      void this.content.open(
        room === "classroom" || room === "library" ? room : "game",
      );
    for (const id of [
      "home",
      "game",
      "classroom",
      "library",
      "kids",
      "database",
    ])
      $(`room-${id}`).setAttribute(
        "aria-current",
        id === room ? "page" : "false",
      );
    if (room === "kids") void this.loadBeginnerLessons();
  }
  private async loadBeginnerLessons(): Promise<void> {
    try {
      const response = await fetch("/content/lessons.json");
      if (!response.ok) throw new Error(`Lesson load ${response.status}`);
      const data = (await response.json()) as {
        lessons: { id: string; title: string }[];
      };
      if (!Array.isArray(data.lessons))
        throw new Error("Invalid lesson catalog");
      const ids = [
        "the_boar",
        "the_rook",
        "the_bish",
        "the_quee",
        "the_king",
        "the_knig",
        "the_pawn",
        "chess_pi",
        "castling",
        "check_an",
        "en_passa",
      ];
      const select = $<HTMLSelectElement>("kids-lesson");
      select.replaceChildren();
      for (const id of ids) {
        const l = data.lessons.find((l) => l.id === id);
        if (!l) continue;
        const o = document.createElement("option");
        o.value = l.id;
        o.textContent = l.title;
        select.append(o);
      }
      if (!select.options.length) throw new Error("Beginner lessons missing");
    } catch (error) {
      if (this.current === "kids")
        $("landing-message").textContent =
          `${String(error)}. Reopen Kids Room to retry.`;
    }
  }
}
