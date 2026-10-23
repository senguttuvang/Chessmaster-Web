import type { RoomName } from "./navigation";

export type AnalyticsConfig = {
  hosts: Record<string, string>;
  ga4: string | null;
};
type EventData = {
  engine_ready: { load_ms: number };
  engine_load_failed: { engine_phase: "load" | "runtime"; load_ms: number };
  game_started: { game_source: "initial" | "new_game" | "settings" | "position" | "lesson" | "tournament"; human_side: "w" | "b" };
  game_completed: { game_result: "white_win" | "black_win" | "draw"; finish_reason: "checkmate" | "stalemate" | "repetition" | "insufficient_material" | "draw"; duration_ms: number };
  lesson_opened: Record<string, never>;
  audio_playback: { audio_channel: "effect" | "narration" };
  renderer_ready: { load_ms: number };
  page_loaded: { load_ms: number };
};
type Payload = Record<string, unknown>;
declare global { interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void } }

const sources = new Set(["x", "twitter", "linkedin"]);
/** Only these public campaign labels may leave the app. Never forward arbitrary queries. */
export function campaignQuery(search: string): string {
  const input = new URLSearchParams(search), output = new URLSearchParams();
  const source = input.get("utm_source")?.toLowerCase();
  if (source && sources.has(source)) output.set("utm_source", source);
  if (input.get("utm_medium") === "social") output.set("utm_medium", "social");
  if (input.get("utm_campaign") === "launch") output.set("utm_campaign", "launch");
  return output.toString();
}
export function referrerOrigin(referrer: string): string {
  try { const url = new URL(referrer); return /^https?:$/.test(url.protocol) ? url.origin : ""; }
  catch { return ""; }
}
export function analyticsAllowed(host: string, protocol: string, automated: boolean, disabled: boolean, hosts: AnalyticsConfig["hosts"]): boolean {
  return protocol === "https:" && Object.hasOwn(hosts, host) && !automated && !disabled;
}
export function boundedDuration(ms: number): number {
  return Math.round(Math.max(0, Math.min(3_600_000, Number.isFinite(ms) ? ms : 0)));
}

/** Optional telemetry stays outside engine/audio control flow and never delays gameplay. */
export class GameplayAnalytics {
  private pending: Payload[] = [];
  private loaded = false;
  private started = false;
  private stopped = false;
  private room: RoomName = "game";
  private lastRoom: RoomName | undefined;
  private audioChannels = new Set<string>();
  private query: string;
  private referrer: string;
  constructor(private config: AnalyticsConfig, private win: Window = window, private doc: Document = document) {
    this.query = campaignQuery(win.location.search);
    this.referrer = referrerOrigin(doc.referrer);
  }
  start(): void {
    if (this.started) return;
    this.started = true;
    let disabled = true;
    try { disabled = this.win.localStorage.getItem("cm9.analytics.disabled") === "1"; }
    catch { /* Unreadable privacy preferences fail closed. */ }
    if (!analyticsAllowed(this.win.location.hostname, this.win.location.protocol, this.win.navigator.webdriver, disabled, this.config.hosts)) {
      this.stopped = true; return;
    }
    const cf = this.script("cm9-cloudflare-analytics", "https://static.cloudflareinsights.com/beacon.min.js");
    cf.dataset.cfBeacon = JSON.stringify({ token: this.config.hosts[this.win.location.hostname], spa: false });
    this.doc.head.append(cf);
    if (this.config.ga4) {
      const win = this.win;
      win.dataLayer ??= [];
      win.gtag = function () { win.dataLayer!.push(arguments); };
      win.gtag("js", new Date());
      win.gtag("set", this.pageParameters());
      win.gtag("config", this.config.ga4, {
        send_page_view: false, allow_google_signals: false,
        allow_ad_personalization_signals: false, ads_data_redaction: true,
        cookie_flags: "SameSite=Lax;Secure", cookie_expires: 0,
      });
      const script = this.script("cm9-ga4-analytics", `https://www.googletagmanager.com/gtag/js?id=${this.config.ga4}`);
      script.onload = () => {
        this.loaded = true;
        script.dataset.status = "loaded";
        const queue = this.pending; this.pending = [];
        for (const payload of queue) this.send(payload);
      };
      script.onerror = () => { script.dataset.status = "failed"; this.pending = []; this.stopped = true; };
      this.doc.head.append(script);
    }
    this.page("game");
    const pageLoaded = () => this.event("page_loaded", { load_ms: boundedDuration(this.win.performance.now()) });
    if (this.doc.readyState === "complete") pageLoaded();
    else this.win.addEventListener("load", pageLoaded, { once: true });
  }
  private script(id: string, url: string): HTMLScriptElement {
    const script = this.doc.createElement("script");
    script.id = id; script.src = url; script.async = true; script.crossOrigin = "anonymous";
    script.dataset.status = "loading";
    script.onload = () => { script.dataset.status = "loaded"; };
    script.onerror = () => { script.dataset.status = "failed"; };
    return script;
  }
  page(room: RoomName): void {
    this.room = room;
    if (this.lastRoom === room) return;
    this.lastRoom = room;
    this.send({ name: "page_view" });
  }
  event<K extends keyof EventData>(name: K, data: EventData[K]): void {
    // Measure audio adoption once per channel per page, not individual source clips.
    if (name === "audio_playback") {
      const channel = (data as EventData["audio_playback"]).audio_channel;
      if (this.audioChannels.has(channel)) return;
      this.audioChannels.add(channel);
    }
    this.send({ name, data });
  }
  private send(event: Payload): void {
    if (this.stopped || !this.config.ga4) return;
    // Capture the current room now, including when the tracker loads later.
    const payload = event.page_location ? event : { ...event, ...this.pageParameters() };
    if (!this.loaded) { if (this.pending.length < 32) this.pending.push(payload); return; }
    try {
      const { name, data, ...page } = payload;
      this.win.gtag?.("set", page);
      this.win.gtag?.("event", name, { ...page, ...(data as Payload), send_to: this.config.ga4 });
    } catch { /* Trackers are optional; engine and media errors remain visible in their own UI. */ }
  }
  private pageParameters(): Payload {
    return {
      page_location: `${this.win.location.origin}/?room=${this.room}${this.query ? "&" + this.query : ""}`,
      page_title: `Chessmaster 9000 · ${this.room}`,
      page_referrer: this.referrer,
      room: this.room,
    };
  }
}
