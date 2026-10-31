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
  view.counts = {
    g: { input: "2100", cached: "1000", output: "100", tools: "6" },
    e: { input: "2100", cached: "1000", output: "100", tools: "6" },
    s: { input: "2100", cached: "1000", output: "100", tools: "6" },
  };
  return view;
}
test.each(["corgi", "animal_style"] as const)(
  "plan renders in terminal cells with visible setback and keyboard folding under %s",
  theme => {
    palette.use(theme);
    const state = new planView.State(),
      view = fixture(),
      terminal = new Terminal(100, 30),
      rect = planView.geometry(100, 30);
    try {
      const writer = new Writer();
      planView.draw(writer, rect, "Download repair", view, state);
      terminal.feed(writer.buffered());
      const screen = terminal.text();
      expect(screen).toContain("Repair download resume");
      expect(state.rows(view).map(r => r.depth)).toEqual([0, 1]);
      expect(screen.split("\n")[rect.y + 5]).toContain("▶   Correct retry offsets");
      expect(screen.split("\n")[rect.y + 6]).toContain("! Run resume tests");
      expect(screen.split("\n").find(line => line.includes("Correct retry offsets"))).not.toContain("!");
      expect(screen).toContain("! Run resume tests");
      expect(screen).not.toContain("✓");
      expect(screen).not.toContain("○");
      expect(screen).not.toContain("▾");
      expect(screen).toContain("Cached 1k (part of input)");
      expect(screen).toContain("6 tool calls");
      expect(state.selected).toBe("e");
      state.toggle();
      const folded = new Writer();
      planView.draw(folded, rect, "Download repair", view, state);
      terminal.feed(folded.buffered());
      expect(terminal.text()).not.toContain("Run resume tests");
      expect(planView.hit(rect, rect.x + 8, rect.y + 5, state, view)).toBe("e");
      expect(planView.key("\x1b")?.name).toBe("plan-close");
    } finally {
      terminal.destroy();
      palette.use("corgi");
    }
  },
);
test("a short terminal retains a close instruction; long labels stay inside the panel", () => {
  const state = new planView.State(),
    writer = new Writer(),
    terminal = new Terminal(35, 10);
  try {
    planView.draw(writer, planView.geometry(35, 10), "Agent", fixture(), state);
    terminal.feed(writer.buffered());
    expect(terminal.text()).toContain("Esc to close");
  } finally {
    terminal.destroy();
  }
});

test("long plans keep two levels, scroll the selection into view, and show the hidden range", () => {
  const view = fixture(),
    state = new planView.State(),
    rect = planView.geometry(100, 24),
    terminal = new Terminal(100, 24);
  for (let i = 0; i < 60; i++) {
    const node = { ...view.nodes[2], id: "s" + i, title: "Inspect work item " + i, bump: null };
    view.nodes.push(node);
    view.counts[node.id] = roadmap.zero();
  }
  const draw = () => {
    const out = new Writer();
    planView.draw(out, rect, "Agent", view, state);
    terminal.feed(out.buffered());
    return terminal.text();
  };
  try {
    expect(draw()).toContain("1–10 of 62 · 52 below");
    expect(terminal.text()).not.toContain("Inspect work item 59");
    state.move(view, Infinity);
    expect(draw()).toContain("Inspect work item 59");
    expect(terminal.text()).toContain("53–62 of 62 · 52 above");
    expect(terminal.text()).toContain("Correct retry offsets (continued)");
    expect(state.rows(view).every(r => r.depth <= 1)).toBe(true);
    state.move(view, -Infinity);
    expect(draw()).toContain("1–10 of 62 · 52 below");
    state.page(view, 1, planView.capacity(rect));
    expect(draw()).toContain("11–20 of 62 · 10 above · 42 below");
    state.scroll(view, 3, planView.capacity(rect));
    expect(draw()).toContain("14–23 of 62 · 13 above · 39 below");
    expect(planView.key("page_down")?.name).toBe("plan-page-next");
    expect(planView.key("end")?.name).toBe("plan-last");
  } finally {
    terminal.destroy();
  }
});
