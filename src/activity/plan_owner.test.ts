import { expect, test } from "bun:test";
import * as owner from "./plan_owner";
import * as plan from "./plan";
import * as roadmap from "./roadmap";
import type { Input } from "./roadmap";

const events = (from: number, to: number, kind: plan.Event["kind"] = "tool"): plan.Event[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    id: from + i,
    turn: 1,
    line: from + i,
    at: "",
    kind,
    text: "Observed test activity",
  }));
const seed = `BEGIN_PLAN
mkdir /g1 active Repair document links
set /g1 subtitle Keep saved document links usable
mkdir /g1/e1 active Diagnose saved links
set /e1 subtitle Trace the missing saved index
mkdir /e1/s1 active Inspect document index
set /s1 subtitle Read saved link lookup fields
set_owner 1 /s1
set_focus 1 /s1`;
const input = (): Input => ({
  state: owner.apply({ state: plan.empty(), events: events(1, 1), support: [] }, seed).state,
  support: [],
  events: events(2, 5),
});

test("explicit owners cover each event once and focus is independent of ownership", () => {
  const source = input(),
    before = structuredClone(source);
  source.events[3].kind = "result";
  before.events[3].kind = "result";
  const result = owner.apply(
    source,
    `mkdir /e1/s2 active Edit index restore
set /s2 subtitle Restore the missing saved lookup
set_owner 5 /s1
set_owner 2..3 /s1
set_focus 4 /s2
set_owner 4 /s2`,
  );
  expect(result.patch.spans).toEqual([
    { from: 2, to: 3, node: "s1", focus: true },
    { from: 4, to: 4, node: "s2", focus: true },
    { from: 5, to: 5, node: "s1", focus: false },
  ]);
  expect(roadmap.focusStep(result.state.spans)).toBe("s2");
  expect(source).toEqual(before);
});

test("focus can change inside an ownership interval and late results cannot change it", () => {
  const source = input();
  source.events[0].kind = "result";
  const prefix = `mkdir /e1/s2 active Edit saved index
set /s2 subtitle Persist the restored lookup index
set_owner 2..5 /s2\n`;
  const result = owner.apply(source, prefix + "set_focus 2 /s2\nset_focus 4 /s2");
  expect(result.patch.spans).toEqual([
    { from: 2, to: 3, node: "s2", focus: false },
    { from: 4, to: 5, node: "s2", focus: true },
  ]);
  const passive = owner.apply(source, prefix + "set_focus 2 /s2");
  expect(roadmap.focusStep(passive.state.spans)).toBe("s1");
  expect(passive.repairs).toContain("ignored passive focus: 2");
});

test("ownership and focus reject gaps, conflicts, old events and planned work atomically", () => {
  const source = input(),
    before = structuredClone(source);
  for (const raw of [
    "set_owner 2..4 /s1",
    "set_owner 2..3 /s1\nset_owner 3..5 none",
    "set_owner 1..5 /s1",
    "set_owner 2..6 /s1",
    "set_owner 5..2 /s1",
    "set_owner 2 5 /s1",
    "set_owner 2..5 /e1",
    "set_owner 2..5 none\nset_focus 3 /s1",
    "set_owner 2..5 /s1\nset_focus 6 /s1",
    "mkdir /e1/p planned Check restored links\nset /p subtitle Verify later\nset_owner 2..5 /p",
    "work /s1 5",
    "note /s1 2 5",
    "ignore 5",
  ]) {
    expect(() => owner.apply(source, raw)).toThrow();
    expect(source).toEqual(before);
  }
});

test("identical ownership is idempotent but conflicting ownership cannot overwrite history", () => {
  const source = input();
  const result = owner.apply(source, "set_owner 2..5 /s1\nset_owner 2..5 /s1");
  expect(result.state).toEqual(owner.apply(source, "set_owner 2..5 /s1").state);
  expect(result.repairs).toEqual(["ignored duplicate ownership"]);
  expect(() => owner.apply(source, "set_owner 2..5 /s1\nset_owner 2..5 none")).toThrow("InvalidCoverage");
});

test("the complete recovery example preserves two distinct failures and the original failed attempt", () => {
  const source = input();
  source.state.through = 50;
  source.state.spans[0].to = 50;
  source.events = events(51, 58);
  const result = owner.apply(source, owner.examples.recovery);
  const failures = result.state.nodes.filter(n => n.bump);
  expect(failures.map(n => [n.id, n.state, n.bump!.kind, n.bump!.state])).toEqual([
    ["s2", "failed", "environment", "resolved"],
    ["s4", "failed", "verification", "open"],
  ]);
  expect(result.state.nodes.find(n => n.id === "s3")?.state).toBe("done");
  expect(result.patch.spans.map(s => [s.from, s.to, s.node])).toEqual([
    [51, 52, "s2"],
    [53, 55, "s3"],
    [56, 58, "s4"],
  ]);
  expect(roadmap.focusStep(result.state.spans)).toBe("s4");
});

test("the complete goal-switch example uses fresh global IDs and retains unrelated open errors", () => {
  const source = input();
  source.state.through = 50;
  source.state.spans[0].to = 50;
  source.events = events(51, 58);
  const failed = owner.apply(source, owner.examples.recovery).state;
  const intermediate = owner.apply(
    { state: failed, support: [], events: events(59, 60) },
    "set_owner 59..60 none",
  ).state;
  const result = owner.apply({ state: intermediate, support: [], events: events(61, 63) }, owner.examples.switchGoal);
  expect(result.state.nodes.filter(n => n.kind === "goal").map(n => n.id)).toEqual(["g1", "g2"]);
  expect(result.state.nodes.find(n => n.id === "s4")?.bump?.state).toBe("open");
  expect(result.state.nodes.find(n => n.id === "s5")?.parent).toBe("e2");
  expect(roadmap.focusStep(result.state.spans)).toBe("s5");
});

test("the complete planning example leaves every TODO and ancestor planned and every event unowned", () => {
  const state = plan.empty();
  state.through = 70;
  state.spans.push({ from: 1, to: 70, node: null, focus: false });
  const result = owner.apply({ state, support: [], events: events(71, 72, "user") }, owner.examples.planning);
  expect(result.state.nodes).toHaveLength(4);
  expect(result.state.nodes.every(n => n.state === "planned")).toBe(true);
  expect(result.patch.spans).toEqual([{ from: 71, to: 72, node: null, focus: false }]);
  expect(roadmap.focusStep(result.state.spans)).toBeNull();
});

test("explicit state fields and compact status updates agree without accepting ambiguous text tails", () => {
  const source = input();
  expect(owner.apply(source, "set /s1 state done\nset_owner 2..5 /s1").state).toEqual(
    owner.apply(source, "set /s1 done\nset_owner 2..5 /s1").state,
  );
  for (const raw of [
    "set /s1 state done Tests passed\nset_owner 2..5 /s1",
    "set /s1 done Tests passed\nset_owner 2..5 /s1",
  ])
    expect(() => owner.apply(source, raw)).toThrow("InvalidOperation");
});
