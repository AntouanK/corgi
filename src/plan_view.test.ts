import { test, expect } from "bun:test";
import * as planView from "./plan_view";
import * as roadmap from "./activity/roadmap";
import { Writer } from "./text";
import { Terminal } from "./pane/terminal";
import * as palette from "./palette";

function fixture(): roadmap.Snapshot {
  const view = roadmap.emptyView();
  view.nodes = [
    {
      id: "g",
      parent: null,
      kind: "goal",
      title: "Repair download resume",
      subtitle: "Keep partial files intact",
      state: "active",
      evidence: [1],
    },
    {
      id: "e",
      parent: "g",
      kind: "episode",
      title: "Correct retry offsets",
      subtitle: "A reset offset repeats the header",
      state: "active",
      evidence: [1],
    },
    {
      id: "s",
      parent: "e",
      kind: "step",
      title: "Run resume tests",
      subtitle: "The existing test exposed the regression",
      state: "failed",
      evidence: [1],
      bump: { kind: "verification", state: "open", detail: "Resume repeats the header", evidence: [1] },
    },
  ];
  view.known = true;
  view.focus = "e";
  view.focus_step = "s";
  view.counts = {
    g: { input: "2100", cached: "1000", output: "100", tools: "6" },
    e: { input: "2100", cached: "1000", output: "100", tools: "6" },
    s: { input: "2100", cached: "1000", output: "100", tools: "6" },
  };
  return view;
}
test.each(["corgi", "animal_style"] as const)(
  "plan renders a compact tail with local problems and whole-plan totals under %s",
  theme => {
    palette.use(theme);
    const view = fixture(),
      terminal = new Terminal(100, 30),
      rect = planView.geometry(100, 30);
    try {
      const writer = new Writer();
      planView.draw(writer, rect, "Download repair", view);
      terminal.feed(writer.buffered());
      const screen = terminal.text();
      expect(screen).toContain("Repair download resume");
      expect(
        planView
          .tail(view, planView.capacity(rect))
          .rows.filter(r => r.kind === "node")
          .map(r => r.depth),
      ).toEqual([0, 1]);
      expect(screen.split("\n")[rect.y + 4]).toContain("▶ Correct retry offsets");
      expect(screen.split("\n")[rect.y + 5]).toContain("! Run resume tests");
      expect(screen.split("\n")[rect.y + 6]).toContain("Resume repeats the header");
      expect(screen.split("\n").find(line => line.includes("Correct retry offsets"))).not.toContain("!");
      expect(screen).toContain("! Run resume tests");
      expect(screen).not.toContain("✓");
      expect(screen).not.toContain("○");
      expect(screen).not.toContain("▾");
      expect(screen.split("\n").find(line => line.includes("Total"))).toMatch(/Total\s+≥2k\s+6\s+1k/);
      expect(screen).not.toContain("A reset offset repeats the header");
      expect(screen).not.toContain("Input ");
      expect(screen).not.toContain("PgUp");
      expect(screen).not.toContain("earlier items");
      expect(planView.key("\x1b")?.name).toBe("plan-close");
    } finally {
      terminal.destroy();
      palette.use("corgi");
    }
  },
);
test("a short terminal retains a close instruction; long labels stay inside the panel", () => {
  const writer = new Writer(),
    terminal = new Terminal(35, 10);
  try {
    planView.draw(writer, planView.geometry(35, 10), "Agent", fixture());
    terminal.feed(writer.buffered());
    expect(terminal.text()).toContain("Esc to close");
  } finally {
    terminal.destroy();
  }
});

test("a short tail keeps a setback, its explanation and episode together", () => {
  const view = fixture(),
    rect = planView.geometry(100, 12),
    terminal = new Terminal(100, 12);
  view.nodes.push({
    ...view.nodes[2],
    id: "s2",
    title: "Retry resume tests",
    bump: { ...view.nodes[2].bump!, state: "resolved" },
  });
  try {
    const out = new Writer();
    planView.draw(out, rect, "Agent", view);
    terminal.feed(out.buffered());
    const lines = terminal.text().split("\n");
    expect(
      planView
        .tail(view, planView.capacity(rect))
        .rows.filter(r => r.kind === "node")
        .map(r => r.node.id),
    ).toEqual(["e", "s2"]);
    expect(lines[rect.y + 4]).toContain("Correct retry offsets");
    expect(lines[rect.y + 5]).toContain("!✓ Retry resume tests");
    expect(lines[rect.y + 6]).toContain("Resume repeats the header");
    expect(terminal.text()).not.toContain("Resolved");
    expect(terminal.text()).not.toContain("more");
    expect(lines[rect.y + 8]).toContain("Total");
    expect(lines[rect.y + 9]).toContain("Esc close");
    expect(terminal.text()).not.toContain("! Run resume tests");
  } finally {
    terminal.destroy();
  }
});

test("long plans follow appended work, retain its episode, and total hidden work", () => {
  const view = fixture(),
    rect = planView.geometry(100, 24),
    terminal = new Terminal(100, 24);
  for (let i = 0; i < 60; i++) {
    const node = { ...view.nodes[2], id: "s" + i, title: "Inspect work item " + i, bump: null };
    view.nodes.push(node);
    view.counts[node.id] = roadmap.zero();
  }
  const draw = () => {
    const out = new Writer();
    planView.draw(out, rect, "Agent", view);
    terminal.feed(out.buffered());
    return terminal.text();
  };
  try {
    expect(draw()).toContain("48 earlier items");
    expect(terminal.text()).toContain("├ … 48 more");
    expect(terminal.text()).not.toContain("(continued)");
    expect(terminal.text()).toContain("Inspect work item 59");
    expect(terminal.text()).not.toContain("Run resume tests");
    expect(terminal.text()).toContain("Correct retry offsets");
    expect(planView.tail(view, planView.capacity(rect)).rows.every(r => r.kind !== "node" || r.depth <= 1)).toBe(true);
    view.unassigned = { input: "1300", cached: "0", output: "0", tools: "1" };
    view.nodes.push({ ...view.nodes[2], id: "latest", title: "Verify final repair", state: "active", bump: null });
    expect(draw()).toContain("Verify final repair");
    expect((terminal.text().match(/▶/g) ?? []).length).toBe(1);
    expect(terminal.text()).toContain("49 earlier items");
    expect(
      terminal
        .text()
        .split("\n")
        .find(line => line.includes("Total")),
    ).toMatch(/Total\s+≥3k\s+7\s+1k/);
    expect(terminal.text()).toContain("1k tokens unassigned");
    expect(planView.key("page_down")).toBeNull();
    expect(planView.key("end")).toBeNull();
    view.nodes[2].state = "active";
    view.nodes[2].bump = null;
    expect(
      planView
        .tail(view, 3)
        .rows.filter(r => r.kind === "node")
        .map(r => r.node.id),
    ).toEqual(["e", "s", "latest"]);
    expect(draw()).toContain("Run resume tests");
  } finally {
    terminal.destroy();
  }
});

test("changing focus preserves episode and step order, including a revisited step in a short tail", () => {
  const view = fixture();
  view.nodes[2].state = "active";
  view.nodes[2].bump = null;
  view.nodes.push(
    { ...view.nodes[2], id: "s2", title: "Run another check" },
    { ...view.nodes[0], id: "g2", title: "Review another feature" },
    { ...view.nodes[1], id: "e2", parent: "g2", title: "Inspect another problem" },
    { ...view.nodes[2], id: "s3", parent: "e2", title: "Read the logs" },
  );
  const ids = (count: number) => planView.tail(view, count).rows.flatMap(r => (r.kind === "node" ? [r.node.id] : []));
  for (const [episode, step] of [
    ["e", "s"],
    ["e2", "s3"],
    ["e", "s2"],
    ["e", "s"],
  ]) {
    view.focus = episode;
    view.focus_step = step;
    expect(ids(20)).toEqual(["e", "s", "s2", "e2", "s3"]);
    const short = ids(4);
    expect(short).toContain(step);
    expect(short).toEqual(["e", "s", "s2", "e2", "s3"].filter(id => short.includes(id)));
    const out = new Writer(),
      terminal = new Terminal(100, 20),
      rect = planView.geometry(100, 20);
    try {
      planView.draw(out, rect, "Agent", view);
      terminal.feed(out.buffered());
      expect(terminal.text().split("\n")[rect.y + 1]).toContain(
        episode === "e" ? "Repair download resume" : "Review another feature",
      );
    } finally {
      terminal.destroy();
    }
  }
});

test("completed work loses both play icons without moving the episode from the tail", () => {
  const view = fixture(),
    rect = planView.geometry(100, 18),
    terminal = new Terminal(100, 18);
  try {
    for (const state of ["active", "done", "active"] as const) {
      view.nodes.forEach(n => {
        n.state = state;
        n.bump = null;
      });
      const out = new Writer();
      planView.draw(out, rect, "Agent", view);
      terminal.feed(out.buffered());
      expect((terminal.text().match(/▶/g) ?? []).length).toBe(state === "active" ? 2 : 0);
      expect(terminal.text().split("\n")[rect.y + 4]).toContain("Correct retry offsets");
      expect(view.focus).toBe("e");
    }
    view.nodes.push(
      { ...view.nodes[1], id: "e2", title: "Verify final repair" },
      { ...view.nodes[2], id: "s2", parent: "e2", title: "Run integration suite" },
    );
    view.focus = "e2";
    view.focus_step = "s2";
    const out = new Writer();
    planView.draw(out, rect, "Agent", view);
    terminal.feed(out.buffered());
    expect(terminal.text()).toContain("▶ Verify final repair");
    expect((terminal.text().match(/▶/g) ?? []).length).toBe(2);
    view.focus = "e";
    view.focus_step = "s";
    expect(
      planView
        .tail(view, 3)
        .rows.filter(r => r.kind === "node")
        .map(r => r.node.id),
    ).toEqual(["e", "s"]);
  } finally {
    terminal.destroy();
  }
});

test("an episode without a known current step shows an ellipsis until attribution arrives", () => {
  const view = fixture();
  view.nodes = view.nodes.slice(0, 2);
  view.focus_step = null;
  expect(planView.tail(view, 3).rows.map(r => r.kind)).toEqual(["node", "pending"]);
  view.nodes.push({ ...fixture().nodes[2], state: "active", bump: null });
  view.focus_step = "s";
  expect(planView.tail(view, 3).rows.map(r => r.kind)).toEqual(["node", "node"]);
  view.nodes.forEach(n => (n.state = "done"));
  expect(planView.tail(view, 3).rows.some(r => r.kind === "pending")).toBe(false);
});

test("alternating investigation steps keep two stable rows, exact costs and one active step", () => {
  const view = fixture();
  view.nodes[2] = { ...view.nodes[2], title: "Trace pending usage across handoff", state: "active", bump: null };
  view.nodes.push({ ...view.nodes[2], id: "tracker", title: "Trace activity tracker handoff state" });
  const order = ["s", "tracker", "s", "tracker", "s", "tracker", "s", "tracker", "s"];
  const inputs = [250_000, 350_000, 675_000, 578_000, 319_000, 112_000, 113_000, 0, 235_000];
  const tools = [7, 4, 10, 6, 3, 1, 1, 1, 2];
  for (let i = 0; i < order.length; i++) {
    view.visits.push({
      step: order[i],
      from: i + 1,
      to: i + 1,
      counts: { input: String(inputs[i]), cached: String(inputs[i] / 2), output: "0", tools: String(tools[i]) },
    });
    view.focus_step = order[i];
    const rows = planView.tail(view, 30, true).rows.filter(r => r.kind === "node");
    expect(rows.map(r => r.node.id)).toEqual(i ? ["e", "s", "tracker"] : ["e", "s"]);
    expect(rows.filter(r => r.current && r.depth === 1).map(r => r.node.id)).toEqual([order[i]]);
    expect(planView.tail(view, 2, true).rows.some(r => r.kind === "node" && r.node.id === order[i] && r.current)).toBe(
      true,
    );
  }
  const rows = planView.tail(view, 30, true).rows.filter(r => r.kind === "node");
  expect(rows.map(r => [r.node.id, r.counts?.input, r.counts?.cached, r.counts?.tools])).toEqual([
    ["e", "2632000", "1316000", "35"],
    ["s", "1592000", "796000", "23"],
    ["tracker", "1040000", "520000", "12"],
  ]);
});

test("failed attempts and retries with the same title remain distinct", () => {
  const view = fixture();
  view.nodes.push({ ...view.nodes[2], id: "retry", state: "active", bump: null });
  view.visits = roadmap.appendVisits(
    [],
    [
      { from: 1, to: 2, node: "s" },
      { from: 3, to: 4, node: "retry" },
    ],
  );
  view.focus_step = "retry";
  const steps = planView
    .tail(view, 10, true)
    .rows.filter(r => r.kind === "node")
    .filter(r => r.depth === 1);
  expect(steps.map(r => r.node.id)).toEqual(["s", "retry"]);
  expect(steps.map(r => r.node.state)).toEqual(["failed", "active"]);
});

test("steps accumulate within an episode while returned episodes keep separate costs", () => {
  const view = fixture();
  view.nodes[2].state = "active";
  view.nodes[2].bump!.evidence = [1];
  view.nodes.push(
    { ...view.nodes[2], id: "s2", title: "Inspect retry logs", bump: null },
    { ...view.nodes[1], id: "e2", title: "Verify cache accounting" },
    { ...view.nodes[2], id: "s3", parent: "e2", title: "Check cache receipts", bump: null },
  );
  view.visits = roadmap.appendVisits(
    [],
    [
      { from: 1, to: 2, node: "s" },
      { from: 3, to: 4, node: "s2" },
      { from: 5, to: 6, node: "s" },
      { from: 7, to: 8, node: "s3" },
      { from: 9, to: 10, node: "s" },
    ],
  );
  view.visits.forEach((v, i) => {
    v.counts = { input: String((i + 1) * 100), cached: "50", output: "0", tools: "1" };
  });
  const rows = planView.tail(view, 30).rows.filter(r => r.kind === "node");
  expect(rows.map(r => r.node.id)).toEqual(["e", "s", "s2", "e2", "s3", "e", "s"]);
  expect(rows.filter(r => r.node.id === "s").map(r => r.counts?.input)).toEqual(["400", "500"]);
  expect(rows.filter(r => r.returned).map(r => r.node.id)).toEqual(["e"]);
  expect(rows.filter(r => r.current).map(r => r.node.id)).toEqual(["e", "s"]);
  expect(rows.filter(r => r.depth === 0).map(r => r.counts?.input)).toEqual(["600", "400", "500"]);
  expect(rows.filter(r => r.node.bump)).toHaveLength(1);
  expect(planView.tail(view, 3).rows.flatMap(r => (r.kind === "node" ? [r.node.id] : []))).toEqual(["e", "s"]);
  const terminal = new Terminal(112, 30),
    rect = planView.geometry(112, 30);
  try {
    const out = new Writer();
    planView.draw(out, rect, "Agent", view);
    terminal.feed(out.buffered());
    const screen = terminal.text();
    expect((screen.match(/▶/g) ?? []).length).toBe(2);
    expect(screen).toContain("▶ ↩ Correct retry offsets");
    expect(screen).not.toContain("↩ Run resume tests");
    expect(
      screen
        .split("\n")
        .filter(l => l.includes("Run resume tests"))
        .at(-1),
    ).toMatch(/▶ Run resume tests\s+500\s+1\s+50/);
    const last = planView.tail(view, 30).rows.at(-1)!;
    expect(last.kind === "node" && last.current).toBe(true);
    view.nodes[2].bump!.state = "resolved";
    const updated = planView.tail(view, 30).rows.filter(r => r.kind === "node");
    expect(updated[1].node.bump?.state).toBe("resolved");
    expect(updated.at(-1)!.node.bump).toBeNull();
  } finally {
    terminal.destroy();
  }
});

test("a running agent keeps a tail marker between named steps without reopening completed work", () => {
  const view = fixture(),
    terminal = new Terminal(100, 18),
    rect = planView.geometry(100, 18);
  view.nodes.forEach(n => {
    n.state = "done";
    n.bump = null;
  });
  view.visits = roadmap.appendVisits([], [{ from: 1, to: 1, node: "s" }]);
  view.visits[0].counts = view.counts.s;
  const before = structuredClone(view);
  const draw = (running: boolean) => {
    const out = new Writer();
    planView.draw(out, rect, "Agent", view, running);
    terminal.feed(out.buffered());
    return terminal.text();
  };
  try {
    expect(draw(true)).toContain("▶ …");
    expect((terminal.text().match(/▶/g) ?? []).length).toBe(1);
    expect(
      terminal
        .text()
        .split("\n")
        .find(l => l.includes("Run resume tests")),
    ).not.toContain("▶");
    expect(terminal.text()).toContain("╰  Run resume tests");
    expect(planView.tail(view, 3, true).rows.at(-1)).toEqual({ kind: "pending", parent: null, active: true });
    expect(view).toEqual(before);
    expect(draw(false)).not.toContain("▶");
    view.nodes[1].state = "active";
    expect((draw(true).match(/▶/g) ?? []).length).toBe(2);
    expect(terminal.text()).toContain("┣▶ …");
    view.nodes[2].state = "active";
    expect(draw(true)).not.toContain("▶ …");
    expect((terminal.text().match(/▶/g) ?? []).length).toBe(2);
    expect(draw(false)).not.toContain("▶");
    const out = new Writer();
    planView.draw(out, rect, "New agent", roadmap.emptyView(), true);
    terminal.feed(out.buffered());
    expect(terminal.text()).toContain("▶ …");
  } finally {
    terminal.destroy();
  }
});
