import { test, expect } from "bun:test";
import * as plan from "./plan";
import * as roadmap from "./roadmap";
import { List } from "./checklist";
import { View, Tokens } from "../usage/live";
import { Actor } from "../conversations";
import { Request, Result, Worker } from "./worker";
import { Text } from "../agents";

const event = (id: number): plan.Event => ({ id, line: id, at: "", turn: 1, kind: "result", text: "Test result" });
const nodes = (): plan.Node[] => [
  {
    id: "g",
    parent: null,
    kind: "goal",
    title: "Repair downloads",
    subtitle: "Retries preserve offsets",
    state: "active",
    evidence: [1],
  },
  {
    id: "e",
    parent: "g",
    kind: "episode",
    title: "Fix retry offsets",
    subtitle: "Retain partial file positions",
    state: "active",
    evidence: [1],
  },
  {
    id: "s",
    parent: "e",
    kind: "step",
    title: "Verify retry offsets",
    subtitle: "Run the existing retry tests",
    state: "active",
    evidence: [1],
  },
];
const patch = (items = nodes(), from = 1, to = from) =>
  JSON.stringify({ nodes: items, spans: [{ from, to, node: "s" }] });
const usage = (input: bigint, cached = 0n) =>
  new View({ known: true, tokens: new Tokens({ input, cached_input: cached, output: 0n }) });

test("live intervals exclude the opening baseline, conserve tokens and retain late usage", () => {
  const road = new roadmap.Roadmap();
  road.observe("t", "working", "Running tests", new List(), usage(1000n, 500n), 1000);
  road.observe("t", "working", "Tests complete", new List(), usage(1200n, 600n), 2000);
  const request = road.request()!;
  expect(road.apply(request, patch(nodes(), 1, 2))).toBe(true);
  expect(road.counts.g).toEqual({ input: "200", cached: "100", output: "0" });
  road.observe("t", "working", "Tests complete", new List(), usage(1250n, 610n), 3000);
  expect(road.counts.g.input).toBe("250");
  expect(roadmap.total(road.view().unassigned)).toBe(0n);
  expect(road.view().partial).toBe(true);
});

test("a validated prefix can finish after more evidence or a new turn arrives, but cannot apply twice", () => {
  const road = new roadmap.Roadmap();
  road.observe("t", "working", "Running tests", new List(), usage(100n), 1000);
  const request = road.request()!;
  road.observe("next", "working", "Review changes", new List(), usage(150n), 2000);
  expect(road.apply(request, patch())).toBe(true);
  expect(road.pending.map(e => e.id)).toEqual([2]);
  expect(road.apply(request, patch())).toBe(false);
  expect(roadmap.total(road.view().unassigned)).toBe(50n);
});

test.each([true, false])("pending work, costs and hierarchy survive restoration, live=%s", live => {
  const road = new roadmap.Roadmap();
  road.observe("t", "working", "Run tests", new List(), usage(100n), 1000);
  road.apply(road.request()!, patch());
  road.observe("t", "working", "Tests failed", new List(), usage(200n), 2000);
  const saved = JSON.parse(JSON.stringify(road)),
    restored = roadmap.Roadmap.restore(saved, live);
  expect(restored.view()).toEqual(road.view());
  expect(restored.request()).toEqual(road.request());
  restored.apply(restored.request()!, patch([], 2));
  expect(restored.counts.g.input).toBe("100");
  expect(restored.baseline !== null).toBe(live);
  saved.pending[0].id++;
  expect(() => roadmap.Roadmap.restore(saved, live)).toThrow("InvalidRoadmap");
});

test("overrun keeps dropped interval tokens explicitly unassigned and never applies a stale patch", () => {
  const road = new roadmap.Roadmap();
  road.observe("t", "working", "Starting", new List(), usage(0n), 1);
  const old = road.request()!;
  for (let i = 1; i <= 40; i++) road.observe("t", "working", "Step " + i, new List(), usage(BigInt(i * 10)), i + 1);
  expect(road.pending).toHaveLength(32);
  expect(roadmap.total(road.view().unassigned)).toBe(400n);
  expect(road.apply(old, patch())).toBe(false);
});

test("done parents reopen around unfinished work and open failures, without rewriting failed attempts", () => {
  const initial = nodes();
  initial[0].state = initial[1].state = "done";
  const applied = plan.apply(plan.empty(), patch(initial), [event(1)]).state;
  expect(applied.nodes.map(n => n.state)).toEqual(["active", "active", "active"]);
  const failed = {
    ...applied.nodes[2],
    state: "failed" as const,
    bump: { kind: "verification" as const, state: "open" as const, detail: "Existing tests fail", evidence: [2] },
  };
  const next = plan.apply(applied, patch([failed], 2), [event(2)]).state;
  expect(() => plan.apply(next, patch([{ ...failed, state: "done" }], 3), [event(3)])).toThrow("RewrittenFailure");
  expect(plan.apply(next, patch([{ ...failed, bump: null }], 3), [event(3)]).state.nodes[2].bump).toEqual(failed.bump);
  expect(() =>
    plan.apply(next, patch([{ ...failed, bump: { ...failed.bump, state: "resolved" } }], 3), [event(3)]),
  ).toThrow("MissingRecoveryEvidence");
  const resolved = { ...failed, bump: { ...failed.bump, state: "resolved" as const, evidence: [2, 3] } };
  expect(plan.apply(next, patch([resolved], 3), [event(3)]).state.nodes[2].bump?.state).toBe("resolved");
});

test("late plan results preserve native labels, and never change the new turn's activity", () => {
  const actor = new Actor({ id: 1 });
  actor.state.provider = "omp";
  actor.state.setTurn("t");
  actor.state.state = "working";
  actor.state.activity = new Text("Native tool intent");
  actor.activity_plan.observe("t", "working", "Test downloads", new List(), usage(0n), 1);
  const request = Object.assign(new Request(), {
    actor: 1,
    road: actor.activity_plan.request(),
    turn_epoch: actor.state.turn_epoch,
  });
  const result = new Result(request, new Text("Verify retry offsets"));
  result.patch = patch();
  expect(result.apply(actor)).toBe(true);
  expect(actor.state.activity.text()).toBe("Native tool intent");
  const worker = new Worker();
  worker.plans = true;
  worker.reconcile([actor]);
  expect(worker.slots.find(Boolean)?.request.road?.events.at(-1)?.text).toContain("Native tool intent");
  actor.state.state = "idle";
  worker.reconcile([actor]);
  expect(worker.slots.find(Boolean)?.request.road?.events.at(-1)?.text).toContain("lifecycle: idle");
  worker.stop();
});

test("checklists are retained as timed intent, not silently converted to completion", () => {
  const road = new roadmap.Roadmap(),
    list = List.of([{ text: "Ship fix", status: "done" }], false, 1000);
  road.observe("t", "working", "Tests still fail", list, usage(10n), 1);
  expect(road.request()!.events[0].text).toContain('"status":"done"');
  expect(road.state.nodes).toHaveLength(0);
  road.observe("t", "working", "Tests still fail", List.of([], false, 2000), usage(10n), 2);
  expect(road.pending[1].text).toContain('"items":[]');
});

test("wire plans reject unsafe IDs, controls, fabricated parents, future bumps and malformed counts", () => {
  const road = new roadmap.Roadmap();
  road.observe("t", "working", "Test", new List(), usage(0n), 1);
  road.apply(road.request()!, patch());
  for (const mutate of [
    (v: roadmap.Snapshot) => {
      v.nodes[0].id = "__proto__";
    },
    (v: roadmap.Snapshot) => {
      v.nodes[0].title = "Terminal \x1b command";
    },
    (v: roadmap.Snapshot) => {
      v.nodes[2].parent = "missing";
    },
    (v: roadmap.Snapshot) => {
      v.counts.g.input = "-1";
    },
  ]) {
    const v = structuredClone(road.view());
    mutate(v);
    expect(() => roadmap.decode(v)).toThrow();
  }
  expect(roadmap.decode(undefined).nodes).toEqual([]);
});
