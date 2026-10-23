/** Produce local offline evidence from the player's own recovered media. */
import { plain } from "../web/src/replay";
import { mkdir } from "node:fs/promises";
const lessons = await Bun.file("web/public/content/lessons.json").json();
const source = lessons.lessons.find((l: { id: string }) => l.id === "tourname");
const raw = await Bun.file("recovery/rooms/static-room-evidence.json").json();
const rules = {
  source: source.source,
  sha256: source.sha256,
  steps: source.steps.map((s: { number: number; raw: string }) => ({
    number: s.number,
    text: plain(s.raw),
  })),
};
const live = {
  schemaVersion: 1,
  status:
    "Offline evidence only. The original online service is not restored. No endpoint is contacted.",
  sources: raw.sources.filter((s: { module: string }) =>
    ["CHESSMAS.EXE", "MPGAME.DLL", "MPCCEXT.DLL"].includes(s.module),
  ),
  strings: raw.strings.filter((s: { rooms: string[] }) =>
    s.rooms.includes("live"),
  ),
  resources: raw.resources.filter((s: { rooms: string[] }) =>
    s.rooms.includes("live"),
  ),
};
await mkdir("web/public/rooms", { recursive: true });
await Bun.write(
  "recovery/rooms/tournament-rules.json",
  JSON.stringify(rules, null, 2) + "\n",
);
await Bun.write(
  "web/public/rooms/tournament-rules.json",
  JSON.stringify(rules, null, 2) + "\n",
);
await Bun.write(
  "web/public/rooms/live-evidence.json",
  JSON.stringify(live, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    ruleSteps: rules.steps.length,
    offlineStrings: live.strings.length,
    offlineResources: live.resources.length,
  }),
);

if (process.argv.includes("--network-analysis")) {
  const code = await Bun.file("recovery/rooms/mpgame.decompiled.c").text();
  const { createHash } = await import("node:crypto");
  const network = {
    schemaVersion: 1,
    source: raw.sources.find(
      (s: { module: string }) => s.module === "MPGAME.DLL",
    ),
    tool: "Ghidra 12.2 / JDK25; ExportRoomNetwork.java; static read-only analysis",
    output: "recovery/rooms/mpgame.decompiled.c",
    outputSha256: createHash("sha256").update(code).digest("hex"),
    functions: [...code.matchAll(/\/\* (MPG_\w+) at ([0-9a-f]+) \*\//g)].map(
      (m) => ({ name: m[1], address: "0x" + m[2] }),
    ),
    limits:
      "Inferred pseudocode only. No original execution or endpoint connection; callback/protocol completeness unverified.",
  };
  await Bun.write(
    "recovery/rooms/network-analysis.json",
    JSON.stringify(network, null, 2) + "\n",
  );
}
