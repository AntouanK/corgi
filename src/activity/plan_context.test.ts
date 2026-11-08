import { expect, test } from "bun:test";
import * as plan from "./plan";
import * as protocol from "./plan_protocol";
import { Context } from "./plan_context";
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
