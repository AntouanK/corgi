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
      expect(planView.tail(view, planView.capacity(rect)).rows.map(r => r.depth)).toEqual([0, 1]);
      expect(screen.split("\n")[rect.y + 4]).toContain("▶   Correct retry offsets");
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
    expect(planView.tail(view, planView.capacity(rect)).rows.map(r => r.node.id)).toEqual(["e", "s2"]);
    expect(lines[rect.y + 4]).toContain("Correct retry offsets (continued)");
    expect(lines[rect.y + 5]).toContain("! Retry resume tests");
    expect(lines[rect.y + 6]).toContain("Resolved · Resume repeats the header");
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
    expect(draw()).toContain("47 earlier items");
    expect(terminal.text()).toContain("Inspect work item 59");
    expect(terminal.text()).not.toContain("Run resume tests");
    expect(terminal.text()).toContain("Correct retry offsets (continued)");
    expect(planView.tail(view, planView.capacity(rect)).rows.every(r => r.depth <= 1)).toBe(true);
    view.unassigned = { input: "1300", cached: "0", output: "0", tools: "1" };
    view.nodes.push({ ...view.nodes[2], id: "latest", title: "Verify final repair", state: "active", bump: null });
    expect(draw()).toContain("Verify final repair");
    expect((terminal.text().match(/▶/g) ?? []).length).toBe(1);
    expect(terminal.text()).toContain("48 earlier items");
    expect(
      terminal
        .text()
        .split("\n")
        .find(line => line.includes("Total")),
    ).toMatch(/Total\s+≥3k\s+7\s+1k/);
    expect(terminal.text()).toContain("1k tokens unassigned");
    expect(planView.key("page_down")).toBeNull();
    expect(planView.key("end")).toBeNull();
  } finally {
    terminal.destroy();
  }
});

test("one episode marker survives completion, pause and retry checkpoints", () => {
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
      expect((terminal.text().match(/▶/g) ?? []).length).toBe(1);
      expect(terminal.text().split("\n")[rect.y + 4]).toContain("▶   Correct retry offsets");
    }
    view.nodes.push(
      { ...view.nodes[1], id: "e2", title: "Verify final repair" },
      { ...view.nodes[2], id: "s2", parent: "e2", title: "Run integration suite" },
    );
    view.focus = "e2";
    const out = new Writer();
    planView.draw(out, rect, "Agent", view);
    terminal.feed(out.buffered());
    expect(terminal.text()).toContain("▶   Verify final repair");
    expect((terminal.text().match(/▶/g) ?? []).length).toBe(1);
    view.focus = "e";
    expect(planView.tail(view, 3).rows.map(r => r.node.id)).toEqual(["e", "s"]);
  } finally {
    terminal.destroy();
  }
});
