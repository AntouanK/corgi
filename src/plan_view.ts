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
    const visit = (parent: string | null, depth: number) => {
      for (const node of view.nodes.filter(n => n.parent === parent)) {
        result.push({ node, depth });
        if (!this.collapsed.has(node.id)) visit(node.id, depth + 1);
      }
    };
    visit(null, 0);
    return result;
  }
  move(view: roadmap.Snapshot, by: number) {
    const rows = this.rows(view),
      at = rows.findIndex(r => r.node.id === this.selected);
    this.selected = rows[Math.max(0, Math.min(rows.length - 1, at + by))]?.node.id ?? "";
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
export const capacity = (rect: Rect) => Math.max(1, Math.floor((rect.h - 12) / 2));
export function hit(rect: Rect, x: number, y: number, state: State, view: roadmap.Snapshot): string | null {
  if (!rect.contains(x, y) || y < rect.y + 4 || y >= rect.y + 4 + capacity(rect) * 2) return null;
  return state.rows(view)[state.offset + Math.floor((y - rect.y - 4) / 2)]?.node.id ?? null;
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
  if (rect.h < 12 || rect.w < 36) {
    line(2, " Enlarge terminal · Esc to close", "muted");
    return;
  }
  const observed = view.nodes
    .filter(n => n.kind === "goal")
    .reduce((sum, n) => roadmap.add(sum, view.counts[n.id] ?? roadmap.zero()), view.unassigned);
  line(
    1,
    view.known
      ? `  ${view.partial ? "≥" : ""}${text.compactCount(roadmap.total(observed))} tokens observed · includes cached input · agent only`
      : "",
    "muted",
  );
  line(
    2,
    `  ▶ running · ! problem encountered${view.known ? " · " + text.compactCount(roadmap.total(view.unassigned)) + " tokens unassigned" : ""}${view.limited ? " · history limit reached" : ""}`,
    "faint",
  );
  line(3, "─".repeat(rect.w), "line");
  state.reveal(view, capacity(rect));
  const rows = state.rows(view).slice(state.offset, state.offset + capacity(rect));
  rows.forEach(({ node, depth }, i) => {
    const selected = node.id === state.selected,
      closed =
        node.state === "done" ||
        node.state === "abandoned" ||
        (node.state === "failed" && node.bump?.state === "resolved"),
      tone: palette.Token = closed ? "muted" : node.state === "planned" ? "faint" : selected ? "strong" : "text";
    const prefix = "  " + "  ".repeat(depth),
      fold = node.kind === "step" ? " " : state.collapsed.has(node.id) ? "+" : " ",
      marker = node.state === "active" ? "▶" : " ",
      issue = node.bump ? "!" : " ",
      counts = view.counts[node.id] ?? roadmap.zero();
    const count = view.known ? text.compactCount(roadmap.total(counts)) : "";
    const title = text.ellipsis(`${prefix}${fold} ${marker} ${issue} ${node.title}`, rect.w - count.length - 3);
    const y = 4 + i * 2;
    line(
      y,
      title + " ".repeat(Math.max(1, rect.w - text.displayWidth(title) - count.length - 2)) + count + "  ",
      tone,
      selected,
    );
    const mark = (column: number, value: string, color: palette.Token, bold = false) => {
      const style = new palette.Style({ fg: color, bg: selected ? "selected" : "surface", bold });
      w.write(`\x1b[${rect.y + y + 1};${rect.x + column + 1}H${style.sgr()}${value}`);
    };
    if (node.state === "active") mark(prefix.length + 2, marker, "accent", true);
    if (node.bump) mark(prefix.length + 4, "!", node.bump.state === "open" ? "warm" : "muted");
    const stats =
      rect.w >= 76
        ? [toolCount(counts), view.known ? `${text.compactCount(BigInt(counts.cached))} cached` : ""]
            .filter(Boolean)
            .join(" · ")
        : "";
    const label = node.state === "active" || node.state === "done" ? "" : node.state + " · ";
    const subtitle = text.ellipsis(prefix + "      " + label + node.subtitle, rect.w - (stats ? stats.length + 4 : 2));
    line(
      y + 1,
      subtitle +
        (stats ? " ".repeat(Math.max(1, rect.w - text.displayWidth(subtitle) - stats.length - 2)) + stats + "  " : ""),
      closed ? "faint" : "muted",
      selected,
    );
  });
  if (!rows.length) {
    line(5, "  The plan will appear as Corgi observes work.", "muted");
    line(7, "  Preview: start Corgi with CORGI_LONG_PLAN=1.", "faint");
  }
  const selected = view.nodes.find(n => n.id === state.selected),
    y = rect.h - 7;
  line(y, "─".repeat(rect.w), "line");
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
    `  ↑↓ select · Enter fold · Esc close     ${state.offset + 1}–${state.offset + rows.length}/${state.rows(view).length}`,
    "muted",
  );
  w.write("\x1b[0m\x1b[?25l");
}
