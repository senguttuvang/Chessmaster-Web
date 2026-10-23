/** Offline evidence viewer. Deliberately contains no original endpoint connection code. */
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
type Evidence = {
  status: string;
  strings: { module: string; address: string; text: string }[];
  resources: {
    module: string;
    resource: {
      name: string;
      type: number;
      text?: string[];
      strings?: { id: number; text: string }[];
    };
  }[];
};
export class LiveRoom {
  private data: Evidence | undefined;
  constructor() {
    $("live-search").oninput = () => this.render();
  }
  async open() {
    try {
      if (!this.data) {
        const r = await fetch("/rooms/live-evidence.json");
        if (!r.ok) throw new Error(`Evidence load ${r.status}`);
        this.data = (await r.json()) as Evidence;
        if (
          !Array.isArray(this.data.strings) ||
          !Array.isArray(this.data.resources)
        )
          throw new Error("Invalid evidence schema");
      }
      this.render();
    } catch (error) {
      $("live-status").textContent =
        `Offline evidence unavailable: ${String(error)}`;
    }
  }
  private render() {
    if (!this.data) return;
    const query = $<HTMLInputElement>("live-search").value.toLowerCase();
    $("live-status").textContent = this.data.status;
    const list = $("live-evidence");
    list.replaceChildren();
    const items = [
      ...this.data.resources.flatMap((r) => [
        {
          source: `${r.module} resource ${r.resource.name}`,
          text: [
            ...(r.resource.text ?? []),
            ...(r.resource.strings ?? []).map((s) => `${s.id}: ${s.text}`),
          ].join(" | "),
        },
      ]),
      ...this.data.strings.map((s) => ({
        source: `${s.module} ${s.address}`,
        text: s.text,
      })),
    ].filter((i) => (i.source + " " + i.text).toLowerCase().includes(query));
    $("live-count").textContent = `${items.length} recovered evidence entries`;
    for (const item of items) {
      const row = document.createElement("li"),
        source = document.createElement("strong"),
        text = document.createElement("p");
      source.textContent = item.source;
      text.textContent = item.text;
      row.append(source, text);
      list.append(row);
    }
  }
}
