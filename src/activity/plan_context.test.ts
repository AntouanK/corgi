import { expect, test } from "bun:test";
import * as plan from "./plan";
import * as protocol from "./plan_protocol";
import * as lines from "./plan_lines";
import { Context, priceBudget } from "./plan_context";
import type { Input } from "./roadmap";

const event = (id: number): plan.Event => ({
  id,
  line: id,
  turn: 1,
  kind: "tool",
  at: "",
  text: "Test the repaired offsets",
});
const input = (): Input => ({ state: plan.empty(), events: [event(1)], support: [] });

test("the line experiment and default JSON protocol receive identical evidence", () => {
  const source = input(),
    request = new Context(lines).prepare(source),
    control = new Context().prepare(source);
  expect(request.instructions).toBe(lines.instructions);
  expect(request.schema).toBeNull();
  expect(control.instructions).toBe(protocol.instructions);
  expect(control.schema).toBe(protocol.schema);
  expect(JSON.parse(request.content.split("\n")[0])).toEqual({ tree: [], focus: null, range: [1, 1] });
  expect(request.content).toContain("@1 1 tool\n Test the repaired offsets");
  expect(JSON.parse(control.content).events).toEqual([[1, 1, "tool", "Test the repaired offsets"]]);
  expect(request.fresh_content).toBe(request.content);
});

test("cached compact updates retain constraints and setbacks, with full fallback on eviction", () => {
  const session = new Context(),
    first = input(),
    request = session.prepare(first);
  const { state } = protocol.apply(
    first,
    JSON.stringify({
      ops: [
        ["+", "g", null, "Fix downloads", "Keep partial files", "a", 1],
        ["+", "e", "g", "Repair offsets", "Offsets must match bytes already saved", "a", 1],
        ["+", "s", "e", "Test retry", "Check resuming after an interruption", "f", 1],
        ["!", "s", "verification", "Offsets repeated bytes", 1],
        ["@", 1, "s", 1],
      ],
    }),
  );
  session.accept(first, state);
  const next = { state, events: [event(2)], support: [event(1)] };
  const continuation = session.prepare(next);
  expect(continuation.conversation).toBe(request.conversation);
  expect(continuation.fresh_content).toBe(protocol.content(next));
  expect(JSON.parse(continuation.content).tree_updates).toEqual(state.nodes.map(protocol.node));
  expect(JSON.parse(continuation.content).support).toEqual([]);
  session.accept(next, { ...state, through: 2 });
  const stable = session.prepare({ ...next, state: { ...state, through: 2 }, events: [event(3)] });
  // Constraints and the unresolved problem remain explicit even when unchanged.
  expect(JSON.parse(stable.content).tree_updates).toEqual(state.nodes.map(protocol.node));
  const diverged = session.prepare(first);
  expect(diverged.conversation).not.toBe(request.conversation);
  expect(diverged.content).toBe(diverged.fresh_content!);
});

test("compact conversations reseed after rejection and sixteen accepted updates", () => {
  const session = new Context();
  let road = input(),
    key = "";
  for (let i = 0; i < 17; i++) {
    const request = session.prepare(road);
    if (i === 0) key = request.conversation!;
    else if (i < 16) expect(request.conversation).toBe(key);
    else expect(request.conversation).not.toBe(key);
    const state = { ...road.state, through: i + 1 };
    session.accept(road, state);
    road = { ...road, state, events: [event(i + 2)] };
  }
  key = session.prepare(road).conversation!;
  session.invalidate();
  const fresh = session.prepare(road);
  expect(fresh.conversation).not.toBe(key);
  expect(fresh.content).toBe(fresh.fresh_content!);
});

test("priced conversations reuse small histories through the provider turn limit", () => {
  const session = new Context(lines, { ...priceBudget, turns: 32 });
  let road = input(),
    key = "";
  for (let i = 0; i < 33; i++) {
    const request = session.prepare(road);
    if (i === 0) key = request.conversation!;
    else if (i < 32) expect(request.conversation).toBe(key);
    else expect(request.conversation).not.toBe(key);
    const state = { ...road.state, through: i + 1 };
    session.accept(road, state, { input: 10_000n, output: 100n });
    road = { ...road, state, events: [event(i + 2)] };
  }
});

test("priced conversations reseed before the next delta crosses the budget", () => {
  const session = new Context(lines, priceBudget),
    first = input(),
    request = session.prepare(first);
  const state = { ...first.state, through: 1 };
  // Input includes cached tokens; output becomes part of the next input too.
  session.accept(first, state, { input: 89_000n, output: 900n });
  const next = { state, events: [{ ...event(2), text: "x".repeat(300) }], support: [] };
  const refreshed = session.prepare(next);
  expect(refreshed.conversation).not.toBe(request.conversation);
  expect(refreshed.content).toBe(lines.encode(protocol.envelope(next)));
  session.accept(next, { ...state, through: 2 }, { input: 10_000n, output: 100n });
  const continued = session.prepare({ ...next, state: { ...state, through: 2 }, events: [event(3)] });
  expect(continued.conversation).toBe(refreshed.conversation);
  session.invalidate();
  expect(session.prepare(next).content).toBe(lines.encode(protocol.envelope(next)));
});

test("repair reuses cached evidence and retains an authoritative seed for eviction", () => {
  const session = new Context(lines, priceBudget),
    first = input(),
    request = session.prepare(first);
  const retry = session.retry(first, "BEGIN_PLAN\nskip 3", "InvalidCoverage", { input: 10_000n, output: 100n });
  expect(retry.conversation).toBe(request.conversation);
  expect(retry.content.length).toBeLessThan(retry.fresh_content!.length);
  expect(JSON.parse(retry.fresh_content!.split("\n")[0])).toMatchObject({
    tree: [],
    focus: null,
    range: [1, 1],
    rejected: "BEGIN_PLAN\nskip 3",
  });
  const accepted = lines.apply(first, "BEGIN_PLAN\nskip 1").state;
  session.accept(first, accepted, { input: 11_000n, output: 100n });
  expect(session.prepare({ ...first, state: accepted, events: [event(2)] }).conversation).toBe(request.conversation);
  const refreshed = session.retry(first, "bad", "InvalidOperation", { input: 91_000n, output: 100n });
  expect(refreshed.conversation).not.toBe(request.conversation);
  expect(refreshed.content).toBe(refreshed.fresh_content!);
});
