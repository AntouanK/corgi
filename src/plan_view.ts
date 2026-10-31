import * as roadmap from "./activity/roadmap";
import type { Node } from "./activity/plan";
import * as palette from "./palette";
import * as text from "./text";
import { Rect } from "./layout";
import type { Action } from "./action";

export class State {
  actor = 0;
  clear() {
    this.actor = 0;
  }
}
type Row = { node: Node; depth: number; continued?: boolean };
const rowHeight = (row: Row) => (row.node.bump ? 2 : 1);
export function tail(view: roadmap.Snapshot, count: number) {
  const all: Row[] = [];
  const episodes: Node[] = [];
  for (const goal of view.nodes.filter(n => n.kind === "goal")) {
    episodes.push(...view.nodes.filter(n => n.parent === goal.id));
  }
  // Returning to an older episode keeps its latest work in the tail.
  const ordered = [...episodes.filter(n => n.id !== view.focus), ...episodes.filter(n => n.id === view.focus)];
  for (const episode of ordered) {
    all.push({ node: episode, depth: 0 });
    for (const step of view.nodes.filter(n => n.parent === episode.id)) all.push({ node: step, depth: 1 });
  }
  let rows: Row[] = [],
    used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    used += rowHeight(all[i]);
    if (used > count) break;
    const parent = all[i].depth === 1 ? view.nodes.find(n => n.id === all[i].node.parent) : null;
    if (used + (parent ? 1 : 0) > count) continue;
    rows = all.slice(i);
    if (parent) rows.unshift({ node: parent, depth: 0, continued: true });
  }
  return { rows, hidden: all.length - rows.length };
}
export function key(input: string): Action | null {
  return input === "\x1b" ? { name: "plan-close" } : null;
}
export function geometry(cols: number, rows: number) {
  const w = Math.max(1, Math.min(112, cols - 2)),
    h = Math.max(1, rows - 2);
  return new Rect(Math.floor((cols - w) / 2), 1, w, h);
}
export const capacity = (rect: Rect) => Math.max(1, rect.h - 7);
export function draw(w: text.Writer, rect: Rect, name: string, view: roadmap.Snapshot) {
  const line = (y: number, value: string, tone: palette.Token = "text") => {
    if (y < 0 || y >= rect.h) return;
    const style = new palette.Style({ fg: tone, bg: "surface", bold: tone === "strong" }),
      clipped = text.ellipsis(value, rect.w),
      padded = clipped + " ".repeat(Math.max(0, rect.w - text.displayWidth(clipped)));
    w.write(`\x1b[${rect.y + y + 1};${rect.x + 1}H${style.sgr()}${padded}`);
  };
  for (let y = 0; y < rect.h; y++) line(y, "");
  line(0, `  Plan · ${name}`, "strong");
  if (rect.h < 10 || rect.w < 36) {
    line(2, " Enlarge terminal · Esc to close", "muted");
    return;
  }
  const { rows, hidden } = tail(view, capacity(rect)),
    last = rows.at(-1)?.node,
    episode = last?.kind === "step" ? view.nodes.find(n => n.id === last.parent) : last,
    goal = view.nodes.find(n => n.id === episode?.parent) ?? view.nodes.findLast(n => n.kind === "goal");
  const observed = view.nodes
    .filter(n => n.kind === "goal")
    .reduce((sum, n) => roadmap.add(sum, view.counts[n.id] ?? roadmap.zero()), view.unassigned);
  line(1, goal ? "  " + goal.title : "", "strong");
  line(2, hidden ? `  … ${hidden} earlier items` : "─".repeat(rect.w), hidden ? "muted" : "line");
  const columns = rect.w >= 88 ? 3 : rect.w >= 60 ? 2 : 1;
  const metric = (values: string[]) =>
    values
      .slice(0, columns)
      .map((v, i) => v.padStart([8, 10, 10][i]))
      .join(" ");
  const stats = (counts: roadmap.Counts, partial = false) =>
    metric([
      view.known ? (partial ? "≥" : "") + text.compactCount(roadmap.total(counts)) : "",
      counts.tools === undefined ? "" : text.compactCount(BigInt(counts.tools)),
      view.known ? text.compactCount(BigInt(counts.cached)) : "",
    ]);
  const row = (y: number, label: string, values: string, tone: palette.Token) => {
    const title = text.ellipsis(label, rect.w - values.length - 4);
    line(
      y,
      title + " ".repeat(Math.max(1, rect.w - text.displayWidth(title) - values.length - 2)) + values + "  ",
      tone,
    );
  };
  row(3, "  Episode / step", metric(["Tokens", "Calls", "Cached"]), "faint");
  let y = 4;
  rows.forEach(({ node, depth, continued }) => {
    const focused = node.id === view.focus,
      closed =
        node.state === "done" ||
        node.state === "abandoned" ||
        (node.state === "failed" && node.bump?.state === "resolved"),
      tone: palette.Token = focused ? "strong" : closed ? "muted" : node.state === "planned" ? "faint" : "text";
    const prefix = "  " + "  ".repeat(depth),
      marker = focused ? "▶" : " ",
      issue = node.bump ? "!" : " ",
      counts = view.counts[node.id] ?? roadmap.zero(),
      suffix = node.state === "planned" ? " (planned)" : continued ? " (continued)" : "";
    row(y, `${prefix}${marker} ${issue} ${node.title}${suffix}`, stats(counts), tone);
    const mark = (column: number, value: string, color: palette.Token, bold = false) => {
      const style = new palette.Style({ fg: color, bg: "surface", bold });
      w.write(`\x1b[${rect.y + y + 1};${rect.x + column + 1}H${style.sgr()}${value}`);
    };
    if (focused) mark(prefix.length, marker, "accent", true);
    if (node.bump) mark(prefix.length + 2, "!", node.bump.state === "open" ? "warm" : "muted");
    y++;
    if (node.bump) {
      const resolved = node.bump.state === "resolved";
      line(y++, prefix + "    " + (resolved ? "Resolved · " : "") + node.bump.detail, resolved ? "faint" : "muted");
    }
  });
  if (!rows.length) line(4, "  The plan will appear as Corgi observes work.", "muted");
  line(rect.h - 3, "─".repeat(rect.w), "line");
  if (columns === 3) row(rect.h - 2, "  Total", stats(observed, view.partial), "strong");
  else {
    const total = [
      view.known ? (view.partial ? "≥" : "") + text.compactCount(roadmap.total(observed)) : "",
      observed.tools === undefined ? "" : text.compactCount(BigInt(observed.tools)) + " calls",
      view.known ? text.compactCount(BigInt(observed.cached)) + " cached" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    line(rect.h - 2, "  Total " + total, "strong");
  }
  const notes = [
    "Esc close",
    view.known && roadmap.total(view.unassigned) > 0n
      ? text.compactCount(roadmap.total(view.unassigned)) + " tokens unassigned"
      : "",
    view.limited ? "History limit reached" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  line(rect.h - 1, "  " + notes, "muted");
  w.write("\x1b[0m\x1b[?25l");
}
