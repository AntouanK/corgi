import * as plan from "./plan";
import * as checklist from "./checklist";
import { clip } from "./tools";
import type { View } from "../usage/live";

export type Counts = { input: string; cached: string; output: string; tools?: string };
export type Input = { state: plan.State; events: plan.Event[]; support: plan.Event[] };
export type Snapshot = {
  nodes: plan.Node[];
  focus: string | null;
  counts: Record<string, Counts>;
  unassigned: Counts;
  known: boolean;
  partial: boolean;
  limited: boolean;
};
export const zero = (): Counts => ({ input: "0", cached: "0", output: "0", tools: "0" });
export const total = (t: Counts) => BigInt(t.input) + BigInt(t.output);
export function add(a: Counts, b: Counts): Counts {
  return {
    input: String(BigInt(a.input) + BigInt(b.input)),
    cached: String(BigInt(a.cached) + BigInt(b.cached)),
    output: String(BigInt(a.output) + BigInt(b.output)),
    tools: a.tools === undefined || b.tools === undefined ? undefined : String(BigInt(a.tools) + BigInt(b.tools)),
  };
}
export function content(input: Input) {
  return JSON.stringify({
    tree: input.state.nodes,
    assign_from: input.events[0].id,
    assign_through: input.events.at(-1)!.id,
    support: input.support,
    events: input.events,
  });
}
export const emptyView = (): Snapshot => ({
  nodes: [],
  focus: null,
  counts: {},
  unassigned: zero(),
  known: false,
  partial: true,
  limited: false,
});
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
function counts(value: unknown): Counts {
  const v = object(value);
  for (const key of ["input", "cached", "output"] as const)
    if (typeof v[key] !== "string" || !/^\d{1,40}$/.test(v[key])) throw Error("InvalidPlanUsage");
  if (v.tools !== undefined && (typeof v.tools !== "string" || !/^\d{1,40}$/.test(v.tools)))
    throw Error("InvalidPlanUsage");
  const out = v as Counts;
  if (BigInt(out.cached) > BigInt(out.input)) throw Error("InvalidPlanUsage");
  return out;
}
export function decode(value: unknown): Snapshot {
  if (value === undefined) return emptyView();
  const v = object(value);
  if (
    !Array.isArray(v.nodes) ||
    v.nodes.length > 256 ||
    typeof v.known !== "boolean" ||
    typeof v.partial !== "boolean" ||
    typeof v.limited !== "boolean"
  )
    throw Error("InvalidRoadmap");
  const through = Math.max(
    1,
    ...v.nodes.flatMap(n => {
      const node = object(n);
      return [
        ...(Array.isArray(node.evidence) ? node.evidence : []),
        ...(Array.isArray(object(node.bump).evidence) ? (object(node.bump).evidence as number[]) : []),
      ].filter(x => typeof x === "number");
    }),
  );
  if (!Number.isSafeInteger(through)) throw Error("InvalidRoadmap");
  const nodes = plan.apply(
    plan.empty(),
    JSON.stringify({ nodes: v.nodes, spans: [{ from: 1, to: through, node: null }] }),
    [
      { id: 1, line: 1, at: "", turn: 0, kind: "lifecycle", text: "" },
      ...(through > 1 ? [{ id: through, line: through, at: "", turn: 0, kind: "lifecycle" as const, text: "" }] : []),
    ],
  ).state.nodes;
  const ledger = object(v.counts);
  const focus = v.focus ?? null;
  if (focus !== null && !nodes.some(n => n.id === focus && n.kind === "episode")) throw Error("InvalidRoadmap");
  return {
    nodes,
    focus: focus as string | null,
    counts: Object.fromEntries(nodes.map(n => [n.id, counts(ledger[n.id])])),
    unassigned: counts(v.unassigned),
    known: v.known,
    partial: v.partial,
    limited: v.limited,
  };
}

/** Latest attributed work determines focus; completion and unassigned events do not move it. */
export function focusEpisode(nodes: plan.Node[], spans: plan.Span[], previous: string | null = null): string | null {
  const latest = spans.findLast(s => s.node !== null),
    step = nodes.find(n => n.id === latest?.node && n.kind === "step");
  return step?.parent ?? previous;
}

/** Observed intervals only. The first sample is a baseline, never historical cost assigned to new work. */
export class Roadmap {
  state = plan.empty();
  focus: string | null = null;
  pending: plan.Event[] = [];
  support: plan.Event[] = [];
  receipts: { event: number; tokens: Counts }[] = [];
  counts: Record<string, Counts> = Object.create(null);
  unassigned = zero();
  baseline: Counts | null = null;
  tools_baseline: string | null = null;
  known = false;
  partial = true;
  limited = false;
  last = "";
  turn = "";
  turn_index = 0;
  checklist_at = 0;
  tail_node: string | null = null;
  observe(turn: string, status: string, evidence: string, list: checklist.List, usage: View, now: number) {
    if (turn !== this.turn) {
      this.turn = turn;
      this.turn_index++;
    }
    const todo = list.at !== this.checklist_at ? JSON.stringify({ items: list.items, partial: list.partial }) : "";
    const text = clip(
      `Turn ${this.turn_index}; lifecycle: ${status}\n${evidence}${todo ? "\nTODO snapshot: " + todo : ""}`,
      6000,
    );
    const key = `${turn}\n${status}\n${evidence}\n${list.at}`;
    const sample = {
      input: String(usage.tokens.input),
      cached: String(usage.tokens.cached_input),
      output: String(usage.tokens.output),
    };
    let delta = zero();
    if (usage.known) {
      this.known = true;
      if (this.baseline)
        for (const field of ["input", "cached", "output"] as const) {
          const n = BigInt(sample[field]) - BigInt(this.baseline[field]);
          if (n >= 0n) delta[field] = String(n);
          else this.partial = true;
        }
      // A delayed cache classification can exceed this interval's input; retain it as a subset.
      delta.cached = String(BigInt(delta.cached) > BigInt(delta.input) ? BigInt(delta.input) : BigInt(delta.cached));
      this.baseline = sample;
    }
    if (this.tools_baseline !== null) {
      const tools = usage.tools - BigInt(this.tools_baseline);
      if (tools >= 0n) delta.tools = String(tools);
      else this.partial = true;
    }
    this.tools_baseline = String(usage.tools);
    if (this.limited) {
      this.unassigned = add(this.unassigned, delta);
      return;
    }
    if (key === this.last) {
      const previous = this.pending.at(-1);
      if (previous) this.receipts.push({ event: previous.id, tokens: delta });
      else this.attribute(this.tail_node, delta);
      this.compactReceipts();
      return;
    }
    this.last = key;
    this.checklist_at = list.at;
    if (this.pending.length === 32) {
      const dropped = this.pending.shift()!;
      this.state.through = dropped.id;
      for (const receipt of this.receipts.filter(r => r.event <= dropped.id))
        this.unassigned = add(this.unassigned, receipt.tokens);
      this.receipts = this.receipts.filter(r => r.event > dropped.id);
      this.partial = true;
    }
    const id = (this.pending.at(-1)?.id ?? this.state.through) + 1;
    this.pending.push({
      id,
      line: id,
      at: new Date(now).toISOString(),
      turn: this.turn_index,
      kind: "assistant",
      text,
    });
    this.receipts.push({ event: id, tokens: delta });
    this.compactReceipts();
  }
  compactReceipts() {
    const merged = new Map<number, Counts>();
    for (const r of this.receipts) merged.set(r.event, add(merged.get(r.event) ?? zero(), r.tokens));
    this.receipts = [...merged].map(([event, tokens]) => ({ event, tokens }));
  }
  request(): Input | null {
    if (!this.pending.length || this.limited) return null;
    return structuredClone({ state: this.state, events: this.pending.slice(0, 8), support: this.support });
  }
  apply(input: Input, raw: string) {
    if (input.state.through !== this.state.through) return false;
    const applied = plan.apply(this.state, raw, input.events).state;
    if (applied.nodes.length > 256) {
      this.limited = true;
      return false;
    }
    const parents = new Map(applied.nodes.map(n => [n.id, n.parent]));
    this.focus = focusEpisode(applied.nodes, applied.spans, this.focus);
    this.tail_node = applied.spans.at(-1)?.node ?? null;
    for (const node of applied.nodes) this.counts[node.id] ??= zero();
    for (const r of this.receipts.filter(r => r.event <= applied.through)) {
      let id = applied.spans.find(s => r.event >= s.from && r.event <= s.to)?.node;
      if (!id) this.unassigned = add(this.unassigned, r.tokens);
      while (id) {
        this.counts[id] = add(this.counts[id], r.tokens);
        id = parents.get(id);
      }
    }
    this.receipts = this.receipts.filter(r => r.event > applied.through);
    this.pending = this.pending.filter(e => e.id > applied.through);
    const cited = new Set(applied.nodes.flatMap(n => [...n.evidence, ...(n.bump?.evidence ?? [])]));
    this.support = [...this.support, ...input.events]
      .filter(e => cited.has(e.id))
      .slice(-128)
      .map(e => ({ ...e, text: clip(e.text, 400) }));
    this.state = { ...applied, spans: [] };
    return true;
  }
  attribute(id: string | null, tokens: Counts) {
    if (!id) this.unassigned = add(this.unassigned, tokens);
    while (id) {
      this.counts[id] = add(this.counts[id] ?? zero(), tokens);
      id = this.state.nodes.find(n => n.id === id)?.parent ?? null;
    }
  }
  view(): Snapshot {
    return {
      nodes: this.state.nodes,
      focus: this.focus,
      counts: this.counts,
      unassigned: this.receipts.reduce((n, r) => add(n, r.tokens), this.unassigned),
      known: this.known,
      partial: this.partial,
      limited: this.limited,
    };
  }
  static restore(value: unknown, live: boolean) {
    const road = new Roadmap();
    if (value === undefined) return road;
    const v = object(value),
      saved = decode(v.view);
    const integer = (key: string) => {
      const n = v[key];
      if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw Error("InvalidRoadmap");
      return n;
    };
    road.state = { nodes: saved.nodes, spans: [], through: integer("through") };
    Object.assign(road, {
      focus: saved.focus,
      counts: saved.counts,
      unassigned: counts(v.unassigned),
      known: saved.known,
      partial: saved.partial,
      limited: saved.limited,
    });
    const events = (value: unknown, limit: number): plan.Event[] => {
      if (!Array.isArray(value) || value.length > limit) throw Error("InvalidRoadmap");
      return value.map(e => {
        const v = object(e);
        if (
          !Number.isSafeInteger(v.id) ||
          Number(v.id) < 1 ||
          v.line !== v.id ||
          typeof v.at !== "string" ||
          v.at.length > 40 ||
          !Number.isSafeInteger(v.turn) ||
          Number(v.turn) < 0 ||
          v.kind !== "assistant" ||
          typeof v.text !== "string" ||
          Buffer.byteLength(v.text) > 6000
        )
          throw Error("InvalidRoadmap");
        return v as plan.Event;
      });
    };
    road.pending = events(v.pending, 32);
    road.support = events(v.support, 128);
    if (
      road.pending.some((e, i) => e.id !== road.state.through + i + 1) ||
      road.support.some(e => e.id > road.state.through)
    )
      throw Error("InvalidRoadmap");
    if (!Array.isArray(v.receipts) || v.receipts.length > 32) throw Error("InvalidRoadmap");
    road.receipts = v.receipts.map(r => {
      const v = object(r);
      if (!road.pending.some(e => e.id === v.event)) throw Error("InvalidRoadmap");
      return { event: Number(v.event), tokens: counts(v.tokens) };
    });
    for (const key of ["last", "turn"] as const) {
      if (typeof v[key] !== "string" || v[key].length > 12000) throw Error("InvalidRoadmap");
      road[key] = v[key];
    }
    road.turn_index = integer("turn_index");
    road.checklist_at = integer("checklist_at");
    if (
      v.tail_node !== null &&
      (typeof v.tail_node !== "string" || !road.state.nodes.some(n => n.id === v.tail_node && n.kind === "step"))
    )
      throw Error("InvalidRoadmap");
    road.tail_node = v.tail_node as string | null;
    if (live && v.baseline !== null) road.baseline = counts(v.baseline);
    if (v.tools_baseline != null) {
      if (typeof v.tools_baseline !== "string" || !/^\d{1,40}$/.test(v.tools_baseline)) throw Error("InvalidRoadmap");
      if (live) road.tools_baseline = v.tools_baseline;
    }
    if (!live) {
      road.last = "";
      road.tail_node = null;
    }
    return road;
  }
  toJSON() {
    return {
      view: this.view(),
      through: this.state.through,
      unassigned: this.unassigned,
      baseline: this.baseline,
      tools_baseline: this.tools_baseline,
      pending: this.pending,
      support: this.support,
      receipts: this.receipts,
      last: this.last,
      turn: this.turn,
      turn_index: this.turn_index,
      checklist_at: this.checklist_at,
      tail_node: this.tail_node,
    };
  }
}
