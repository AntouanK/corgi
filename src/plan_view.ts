import * as roadmap from "./activity/roadmap";
import type { Node } from "./activity/plan";
import * as palette from "./palette";
import * as text from "./text";
import { Rect } from "./layout";
import type { Action } from "./action";

export class State {
  actor = 0;
  selected = "";
  offset = 0;
  collapsed = new Set<string>();
  rows(view: roadmap.Snapshot) {
    const result: { node: Node; depth: number }[] = [];
    for (const goal of view.nodes.filter(n => n.kind === "goal")) {
      for (const episode of view.nodes.filter(n => n.parent === goal.id)) {
        result.push({ node: episode, depth: 0 });
        if (!this.collapsed.has(episode.id))
          for (const step of view.nodes.filter(n => n.parent === episode.id)) result.push({ node: step, depth: 1 });
      }
    }
    return result;
  }
  move(view: roadmap.Snapshot, by: number) {
    const rows = this.rows(view),
      at = rows.findIndex(r => r.node.id === this.selected);
    this.selected = rows[Math.max(0, Math.min(rows.length - 1, at + by))]?.node.id ?? "";
  }
  page(view: roadmap.Snapshot, by: number, count: number) {
    this.move(view, by * count);
    this.offset = Math.max(0, Math.min(this.offset + by * count, this.rows(view).length - count));
  }
  scroll(view: roadmap.Snapshot, by: number, count: number) {
    const rows = this.rows(view),
      selected = rows.findIndex(r => r.node.id === this.selected);
    this.offset = Math.max(0, Math.min(this.offset + by, rows.length - count));
    const index = Math.max(this.offset, Math.min(selected, this.offset + count - 1));
    this.selected = rows[index]?.node.id ?? "";
  }
  navigate(view: roadmap.Snapshot, action: Action, count: number) {
    switch (action.name) {
      case "plan-next":
      case "plan-prev":
        this.move(view, action.name === "plan-next" ? 1 : -1);
        break;
      case "plan-page-next":
      case "plan-page-prev":
        this.page(view, action.name === "plan-page-next" ? 1 : -1, count);
        break;
      case "plan-scroll-next":
      case "plan-scroll-prev":
        this.scroll(view, action.name === "plan-scroll-next" ? 3 : -3, count);
        break;
      case "plan-first":
      case "plan-last":
        this.move(view, action.name === "plan-first" ? -Infinity : Infinity);
        break;
      case "plan-toggle":
        if (view.nodes.some(n => n.id === this.selected && n.kind === "episode")) this.toggle();
        break;
      case "plan-select": {
        const node = view.nodes.find(n => n.id === action.value && n.kind !== "goal");
        if (!node) break;
        if (this.selected === node.id && node.kind === "episode") this.toggle();
        else this.selected = node.id;
        break;
      }
    }
  }
  toggle() {
    if (this.collapsed.has(this.selected)) this.collapsed.delete(this.selected);
    else this.collapsed.add(this.selected);
  }
  clear() {
    this.actor = 0;
    this.selected = "";
    this.offset = 0;
    this.collapsed.clear();
  }
  reveal(view: roadmap.Snapshot, count: number) {
    const rows = this.rows(view);
    let i = rows.findIndex(r => r.node.id === this.selected);
    if (i < 0) {
      i = 0;
      this.selected = rows[0]?.node.id ?? "";
    }
    this.offset = Math.max(0, Math.min(this.offset, Math.max(0, rows.length - count)));
    if (i < this.offset) this.offset = i;
    if (i >= this.offset + count) this.offset = Math.max(0, i - count + 1);
  }
}
export function key(input: string): Action | null {
  switch (input) {
    case "\x1b":
      return { name: "plan-close" };
    case "j":
    case "down":
    case "\x0e":
      return { name: "plan-next" };
    case "k":
    case "up":
    case "\x10":
      return { name: "plan-prev" };
    case "page_down":
      return { name: "plan-page-next" };
    case "page_up":
      return { name: "plan-page-prev" };
    case "home":
      return { name: "plan-first" };
    case "end":
      return { name: "plan-last" };
    case "\r":
    case " ":
    case "left":
    case "right":
      return { name: "plan-toggle" };
    default:
      return null;
  }
}
export function geometry(cols: number, rows: number) {
  const w = Math.max(1, Math.min(112, cols - 2)),
    h = Math.max(1, rows - 2);
  return new Rect(Math.floor((cols - w) / 2), 1, w, h);
}
export const capacity = (rect: Rect) => Math.max(1, rect.h - 12);
export function hit(rect: Rect, x: number, y: number, state: State, view: roadmap.Snapshot): string | null {
  if (!rect.contains(x, y) || y < rect.y + 5 || y >= rect.y + 5 + capacity(rect)) return null;
  return state.rows(view)[state.offset + y - rect.y - 5]?.node.id ?? null;
}
function toolCount(counts: roadmap.Counts, full = false) {
  if (counts.tools === undefined) return "";
  const n = BigInt(counts.tools);
  return `${text.compactCount(n)} ${full ? "tool " : ""}call${n === 1n ? "" : "s"}`;
}
export function draw(w: text.Writer, rect: Rect, name: string, view: roadmap.Snapshot, state: State) {
  const line = (y: number, value: string, tone: palette.Token = "text", selected = false) => {
    if (y < 0 || y >= rect.h) return;
    const style = new palette.Style({ fg: tone, bg: selected ? "selected" : "surface", bold: tone === "strong" }),
      clipped = text.ellipsis(value, rect.w),
      padded = clipped + " ".repeat(Math.max(0, rect.w - text.displayWidth(clipped)));
    w.write(`\x1b[${rect.y + y + 1};${rect.x + 1}H${style.sgr()}${padded}`);
  };
  for (let y = 0; y < rect.h; y++) line(y, "");
  line(0, `  Plan · ${name}`, "strong");
  if (rect.h < 13 || rect.w < 36) {
    line(2, " Enlarge terminal · Esc to close", "muted");
    return;
  }
  state.reveal(view, capacity(rect));
  const all = state.rows(view),
    rows = all.slice(state.offset, state.offset + capacity(rect)),
    selected = view.nodes.find(n => n.id === state.selected),
    episode = selected?.kind === "step" ? view.nodes.find(n => n.id === selected.parent) : selected,
    goal = view.nodes.find(n => n.id === episode?.parent) ?? view.nodes.find(n => n.kind === "goal");
  const observed = view.nodes
    .filter(n => n.kind === "goal")
    .reduce((sum, n) => roadmap.add(sum, view.counts[n.id] ?? roadmap.zero()), view.unassigned);
  line(1, goal ? "  " + goal.title : "", "strong");
  const summary = [
    view.known ? `${view.partial ? "≥" : ""}${text.compactCount(roadmap.total(observed))} tokens` : "",
    toolCount(observed),
    view.known ? `${text.compactCount(roadmap.total(view.unassigned))} unassigned tokens` : "",
    view.limited ? "History limit reached" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  line(2, "  " + summary, "muted");
  line(3, "─".repeat(rect.w), "line");
  const metric = (values: string[]) => values.map((v, i) => v.padStart([8, 10, 10][i])).join(" ");
  const columns = rect.w >= 88 ? 3 : rect.w >= 60 ? 2 : 1;
  const heading = metric(["Tokens", "Calls", "Cached"].slice(0, columns));
  const row = (y: number, label: string, stats: string, tone: palette.Token, selected = false) => {
    const title = text.ellipsis(label, rect.w - stats.length - 5);
    line(
      y,
      title + " ".repeat(Math.max(1, rect.w - text.displayWidth(title) - stats.length - 3)) + stats + "   ",
      tone,
      selected,
    );
  };
  const continued = rows[0]?.node.kind === "step" && view.nodes.find(n => n.id === rows[0].node.parent);
  row(4, continued ? "  " + continued.title + " (continued)" : "  Episode / step", heading, "faint");
  rows.forEach(({ node, depth }, i) => {
    const focused = node.id === state.selected,
      closed =
        node.state === "done" ||
        node.state === "abandoned" ||
        (node.state === "failed" && node.bump?.state === "resolved"),
      tone: palette.Token = closed ? "muted" : node.state === "planned" ? "faint" : focused ? "strong" : "text";
    const prefix = "  " + "  ".repeat(depth),
      fold = node.kind === "episode" && state.collapsed.has(node.id) ? "+" : " ",
      marker = node.state === "active" ? "▶" : " ",
      issue = node.bump ? "!" : " ",
      counts = view.counts[node.id] ?? roadmap.zero();
    const stats = metric(
      [
        view.known ? text.compactCount(roadmap.total(counts)) : "",
        counts.tools === undefined ? "" : text.compactCount(BigInt(counts.tools)),
        view.known ? text.compactCount(BigInt(counts.cached)) : "",
      ].slice(0, columns),
    );
    const label = node.state === "planned" ? " (planned)" : "";
    const y = 5 + i;
    row(y, `${prefix}${fold} ${marker} ${issue} ${node.title}${label}`, stats, tone, focused);
    const mark = (column: number, value: string, color: palette.Token, bold = false) => {
      const style = new palette.Style({ fg: color, bg: focused ? "selected" : "surface", bold });
      w.write(`\x1b[${rect.y + y + 1};${rect.x + column + 1}H${style.sgr()}${value}`);
    };
    if (node.state === "active") mark(prefix.length + 2, marker, "accent", true);
    if (node.bump) mark(prefix.length + 4, "!", node.bump.state === "open" ? "warm" : "muted");
  });
  if (all.length > rows.length) {
    const height = capacity(rect),
      thumb = Math.max(1, Math.floor((height * height) / all.length)),
      top = Math.round(((height - thumb) * state.offset) / (all.length - height));
    for (let i = 0; i < height; i++) {
      const style = new palette.Style({ fg: i >= top && i < top + thumb ? "muted" : "line", bg: "surface" });
      w.write(`\x1b[${rect.y + 6 + i};${rect.x + rect.w - 1}H${style.sgr()}${i >= top && i < top + thumb ? "█" : "│"}`);
    }
  }
  if (!rows.length) {
    line(5, "  The plan will appear as Corgi observes work.", "muted");
    line(7, "  Preview: start Corgi with CORGI_LONG_PLAN=1.", "faint");
  }
  const y = rect.h - 7;
  const above = state.offset,
    below = Math.max(0, all.length - state.offset - rows.length);
  const range = `${rows.length ? state.offset + 1 : 0}–${state.offset + rows.length} of ${all.length}${above ? " · " + above + " above" : ""}${below ? " · " + below + " below" : ""}`;
  line(y, "── " + range + " " + "─".repeat(Math.max(0, rect.w - text.displayWidth(range) - 4)), "muted");
  if (selected) {
    const counts = view.counts[selected.id] ?? roadmap.zero();
    line(y + 1, `  ${selected.state} · ${selected.title}`, "muted");
    line(
      y + 2,
      selected.bump
        ? `  ! Problem ${selected.bump.state === "open" ? "encountered" : "resolved"}: ${selected.bump.detail}`
        : `  ${selected.subtitle}`,
      selected.bump?.state === "open" ? "warm" : "muted",
    );
    line(
      y + 3,
      view.known
        ? `  Input ${text.compactCount(BigInt(counts.input))} · output ${text.compactCount(BigInt(counts.output))}`
        : "",
      "muted",
    );
    line(y + 4, view.known ? `  Cached ${text.compactCount(BigInt(counts.cached))} (part of input)` : "", "faint");
    line(y + 5, "  " + toolCount(counts, true), "muted");
  }
  line(
    rect.h - 1,
    rect.w >= 72
      ? "  ↑↓ select · PgUp/PgDn scroll · Home/End · Enter fold · Esc close"
      : "  ↑↓ · PgUp/PgDn · Enter fold · Esc",
    "muted",
  );
  w.write("\x1b[0m\x1b[?25l");
}
