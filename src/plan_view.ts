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
type Row =
  | { kind: "node"; node: Node; depth: number }
  | { kind: "more"; parent: Node; count: number }
  | { kind: "pending"; parent: Node };
const rowHeight = (row: Row) => (row.kind === "node" && row.node.bump ? 2 : 1);
const currentStep = (view: roadmap.Snapshot, node: Node) => node.id === view.focus_step && node.state === "active";
export function tail(view: roadmap.Snapshot, count: number) {
  const all: Row[] = [];
  const episodes = view.nodes.filter(n => n.kind === "episode");
  const step = view.nodes.find(n => n.id === view.focus_step);
  // Returning to earlier work keeps it in the tail.
  const ordered = [...episodes.filter(n => n.id !== view.focus), ...episodes.filter(n => n.id === view.focus)];
  for (const episode of ordered) {
    all.push({ kind: "node", node: episode, depth: 0 });
    const steps = view.nodes.filter(n => n.parent === episode.id);
    for (const step of [...steps.filter(n => !currentStep(view, n)), ...steps.filter(n => currentStep(view, n))])
      all.push({ kind: "node", node: step, depth: 1 });
    if (
      episode.id === view.focus &&
      episode.state === "active" &&
      (!step || ["done", "abandoned", "planned"].includes(step.state))
    )
      all.push({ kind: "pending", parent: episode });
  }
  let rows: Row[] = [],
    used = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    used += rowHeight(all[i]);
    if (used > count) break;
    const first = all[i];
    const parent =
      first.kind === "node"
        ? first.depth === 1
          ? view.nodes.find(n => n.id === first.node.parent)
          : null
        : first.parent;
    const candidate = all.slice(i);
    if (parent) {
      const hidden = all.slice(0, i).filter(r => r.kind === "node" && r.node.parent === parent.id).length;
      const minimum = rowHeight(all.at(-1)!) + 1;
      if (hidden >= 2 && count > minimum) candidate.unshift({ kind: "more", parent, count: hidden });
      candidate.unshift({ kind: "node", node: parent, depth: 0 });
    }
    if (candidate.reduce((sum, r) => sum + rowHeight(r), 0) <= count) rows = candidate;
  }
  return { rows, hidden: all.filter(r => r.kind === "node").length - rows.filter(r => r.kind === "node").length };
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
    const style = new palette.Style({ fg: tone, bg: "surface", bold: tone === "strong" || tone === "accent" }),
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
    lastRow = rows.at(-1),
    last = lastRow?.kind === "node" ? lastRow.node : lastRow?.parent,
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
  const mark = (column: number, value: string, color: palette.Token, bold = false, strike = false) => {
    const style = new palette.Style({ fg: color, bg: "surface", bold, strike });
    w.write(`\x1b[${rect.y + y + 1};${rect.x + column + 1}H${style.sgr()}${value}`);
  };
  rows.forEach((entry, i) => {
    const next = rows[i + 1],
      last = !next || (next.kind === "node" && next.depth === 0);
    if (entry.kind !== "node") {
      line(y++, `    ${last ? "╰" : "├"} …${entry.kind === "more" ? ` ${entry.count} more` : ""}`, "faint");
      return;
    }
    const { node, depth } = entry;
    const focused = node.id === view.focus,
      current = currentStep(view, node),
      closed =
        node.state === "done" ||
        node.state === "abandoned" ||
        (node.state === "failed" && node.bump?.state === "resolved");
    let tone: palette.Token = "text";
    if (current) tone = "accent";
    else if (focused) tone = "strong";
    else if (closed) tone = "muted";
    else if (node.state === "planned") tone = "faint";
    const branch = current ? "┣" : last ? "╰" : "├",
      prefix = depth ? "    " + branch : "  ",
      active = focused || current,
      issue = node.bump ? (node.bump.state === "resolved" ? "!✓" : "!") : "",
      marker = (active ? "▶" : "") + issue || " ",
      counts = view.counts[node.id] ?? roadmap.zero(),
      suffix = node.state === "planned" ? " (planned)" : "";
    row(y, `${prefix}${marker} ${node.title}${suffix}`, stats(counts), tone);
    if (depth) mark(4, branch, current ? "accent" : "line", current);
    if (active) mark(prefix.length, "▶", "accent", true);
    if (issue) mark(prefix.length + (active ? 1 : 0), issue, node.bump!.state === "open" ? "warm" : "muted");
    y++;
    if (node.bump) {
      const resolved = node.bump.state === "resolved",
        column = prefix.length + marker.length + 1,
        detail = text.ellipsis(node.bump.detail, rect.w - column);
      line(y, " ".repeat(column) + detail, resolved ? "faint" : "muted");
      if (resolved) mark(column, detail, "faint", false, true);
      if (!last || current) mark(4, current ? "┃" : "│", current ? "accent" : "line");
      y++;
    }
  });
  if (!rows.length) line(4, "  …", "faint");
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
