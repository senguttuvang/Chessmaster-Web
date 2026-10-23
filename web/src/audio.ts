import { Schema } from "effect";
import type { Chess, Move } from "chess.js";

const ClipSchema = Schema.Struct({ url: Schema.String, duration: Schema.Number, partial: Schema.Boolean });
const IndexSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  clips: Schema.Record({ key: Schema.String, value: ClipSchema }),
  events: Schema.Record({ key: Schema.String, value: Schema.String }),
  images: Schema.Record({ key: Schema.String, value: Schema.String }),
});
type AudioIndex = Schema.Schema.Type<typeof IndexSchema>;
export type SoundEvent = "WhiteMove" | "BlackMove" | "Capture" | "Castle" | "Promotion" | "Check" | "Checkmate" | "Draw" | "IllegalMove";

/** Called once per committed move, never from rendering or history replay. */
export function moveSoundEvents(move: Pick<Move, "color" | "flags" | "captured" | "promotion">, game: Pick<Chess, "isCheckmate" | "isDraw" | "isCheck">): SoundEvent[] {
  const events: SoundEvent[] = [move.flags.includes("k") || move.flags.includes("q") ? "Castle"
    : move.promotion ? "Promotion" : move.captured ? "Capture" : move.color === "w" ? "WhiteMove" : "BlackMove"];
  if (game.isCheckmate()) events.push("Checkmate");
  else if (game.isDraw()) events.push("Draw");
  else if (game.isCheck()) events.push("Check");
  return events;
}

export interface ClipOutput {
  play(url: string, id: string, duration: number): Promise<void>;
  stop(): void;
  volume: number;
}

/** A cancellation-aware FIFO shared by effects and exact-ID narration. */
export class ClipQueue {
  private epoch = 0;
  private tail: Promise<void> = Promise.resolve();
  constructor(private output: ClipOutput, private report: (message: string) => void) {}
  stop(): void { ++this.epoch; this.output.stop(); }
  enqueue(work: () => Promise<readonly { url: string; id: string; duration: number }[]>, replace = false): Promise<void> {
    if (replace) this.stop();
    const epoch = this.epoch;
    this.tail = this.tail.then(async () => {
      try {
        if (epoch !== this.epoch) return;
        const clips = await work();
        for (const clip of clips) {
          if (epoch !== this.epoch) return;
          await this.output.play(clip.url, clip.id, clip.duration);
        }
      } catch (error) {
        if (epoch === this.epoch) this.report("Sound unavailable: " + String(error));
      }
    });
    return this.tail;
  }
}

class ElementOutput implements ClipOutput {
  readonly element = document.createElement("audio");
  private finish: (() => void) | undefined;
  private version = 0;
  get volume() { return this.element.volume; }
  set volume(value: number) { this.element.volume = value; }
  constructor(channel: string, private report: (message: string) => void) {
    this.element.hidden = true;
    this.element.preload = "none";
    this.element.dataset.audioChannel = channel;
    document.body.append(this.element);
    this.element.addEventListener("playing", () => {
      this.element.dataset.lastPlayed = this.element.dataset.clip;
      this.element.dataset.playCount = String(Number(this.element.dataset.playCount ?? 0) + 1);
      this.report("Playing original " + channel + ": " + this.element.dataset.clip);
    });
  }
  play(url: string, id: string, duration: number): Promise<void> {
    this.stop();
    const version = this.version;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => fail("Playback timed out for " + id), Math.max(15000, duration * 1000 + 15000));
      const clear = () => { clearTimeout(timer); this.element.onended = null; this.element.onerror = null; this.finish = undefined; };
      const done = () => { if (version !== this.version) return; clear(); resolve(); };
      const fail = (message: string) => { if (version !== this.version) return; clear(); this.element.pause(); reject(new Error(message)); };
      this.finish = done;
      this.element.onended = done;
      this.element.onerror = () => fail("Cannot load " + id + ". Prepare or restore the original audio files.");
      this.element.dataset.clip = id;
      this.element.src = url;
      void this.element.play().catch(error => fail(error.name === "NotAllowedError"
        ? "Browser blocked sound. Use Enable sound and retry the action." : id + ": " + error.message));
    });
  }
  stop(): void {
    this.element.pause();
    this.finish?.();
    ++this.version;
    this.element.removeAttribute("src");
    this.element.load();
  }
}

export class BrowserAudio {
  enabled = true;
  narrationEnabled = true;
  private unlocked = false;
  private index: AudioIndex | undefined;
  private loading: Promise<AudioIndex> | undefined;
  private names = new Map<string, string>();
  private effectOutput: ElementOutput;
  private voiceOutput: ElementOutput;
  private effects: ClipQueue;
  private voices: ClipQueue;
  constructor(private report: (message: string) => void) {
    this.effectOutput = new ElementOutput("effect", report);
    this.voiceOutput = new ElementOutput("narration", report);
    this.effects = new ClipQueue(this.effectOutput, report);
    this.voices = new ClipQueue(this.voiceOutput, report);
    try {
      const stored: unknown = JSON.parse(localStorage.getItem("chessmaster9000.audio.v1") ?? "null");
      if (stored && typeof stored === "object") {
        const p = stored as Record<string, unknown>;
        if (typeof p.enabled === "boolean") this.enabled = p.enabled;
        if (typeof p.narration === "boolean") this.narrationEnabled = p.narration;
        if (typeof p.volume === "number" && Number.isFinite(p.volume) && p.volume >= 0 && p.volume <= 1) this.volume = p.volume;
      }
    } catch { report("Sound preferences could not be read; using the current controls."); }
  }
  get volume() { return this.effectOutput.volume; }
  set volume(value: number) { this.effectOutput.volume = this.voiceOutput.volume = Math.max(0, Math.min(1, value)); }
  unlock(): void { this.unlocked = true; }
  configure(enabled: boolean, narration: boolean, volume: number): void {
    this.unlock();
    this.enabled = enabled; this.narrationEnabled = narration; this.volume = volume;
    if (!enabled) this.stop();
    else if (!narration) this.stopNarration();
    try { localStorage.setItem("chessmaster9000.audio.v1", JSON.stringify({ enabled, narration, volume: this.volume })); }
    catch { this.report("Sound works, but this browser could not save its preferences."); }
    this.report(enabled ? "Original sound enabled." : "Sound muted.");
  }
  async load(): Promise<AudioIndex> {
    if (this.index) return this.index;
    if (!this.loading) this.loading = (async () => {
      try {
        const response = await fetch("/audio/index.json");
        if (!response.ok) throw new Error("Original audio is not prepared (HTTP " + response.status + ").");
        const index = Schema.decodeUnknownSync(IndexSchema)(await response.json());
        for (const clip of Object.values(index.clips))
          if (!/^\/audio\/[a-zA-Z0-9_./-]+$/.test(clip.url) || clip.url.includes("..") || !Number.isFinite(clip.duration) || clip.duration <= 0)
            throw new Error("Invalid original audio index");
        for (const url of Object.values(index.images))
          if (!/^\/audio\/illustrations\/[a-f0-9]+\.png$/.test(url)) throw new Error("Invalid illustration URL");
        this.index = index;
        // Exact case-insensitive names; tutorial owns same-named lesson references.
        for (const group of ["nla", "moves", "jwaudio", "tutorial"])
          for (const id of Object.keys(index.clips))
            if (id.startsWith(group + ":")) this.names.set(id.slice(group.length + 1).toLowerCase(), id);
        return index;
      } finally { this.loading = undefined; }
    })();
    return this.loading;
  }
  events(events: readonly SoundEvent[]): void {
    if (!this.enabled || !this.unlocked) return;
    void this.effects.enqueue(async () => {
      const index = await this.load();
      if (!this.enabled) return [];
      return events.map(event => {
        const id = index.events[event], clip = index.clips[id];
        if (!clip) throw new Error("Original sound missing for " + event);
        return { ...clip, id };
      });
    });
  }
  narrate(references: readonly string[]): Promise<void> {
    if (!this.enabled || !this.narrationEnabled || !this.unlocked || !references.length) { this.stopNarration(); return Promise.resolve(); }
    return this.voices.enqueue(async () => {
      const index = await this.load();
      if (!this.enabled || !this.narrationEnabled) return [];
      const clips = [];
      const missing = [];
      for (const reference of references) {
        const name = reference.toLowerCase().endsWith(".raw") ? reference.toLowerCase() : reference.toLowerCase() + ".raw";
        const id = this.names.get(name), clip = id ? index.clips[id] : undefined;
        if (!clip || !id) { missing.push(reference); continue; }
        if (clip.partial) this.report("Original clip has a source tail defect: " + reference);
        clips.push({ ...clip, id });
      }
      if (missing.length) this.report("Original narration missing: " + missing.join(", "));
      return clips;
    }, true);
  }
  async illustration(reference: string): Promise<string> {
    const index = await this.load();
    const url = index.images[reference.toLowerCase()];
    if (!url) throw new Error("Original illustration missing: " + reference);
    return url;
  }
  stopNarration(): void { this.voices.stop(); }
  stop(): void { this.effects.stop(); this.voices.stop(); }
}
