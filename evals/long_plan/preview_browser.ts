import * as planView from "../../src/plan_view";
import * as palette from "../../src/palette";
import * as roadmap from "../../src/activity/roadmap";
import { Writer } from "../../src/text";
import { grid } from "../../site/terminal";
import type { Action } from "../../src/action";

type Replay = {
  key: string;
  id: string;
  ablation: string;
  model: string;
  source: string;
  checkpoints: { through: number; view: roadmap.Snapshot }[];
  failures: string[];
};
const data: Replay[] = JSON.parse(document.querySelector("#data")!.textContent!);
const session = document.querySelector<HTMLSelectElement>("#session")!,
  slider = document.querySelector<HTMLInputElement>("#checkpoint")!,
  screen = document.querySelector<HTMLElement>("#screen")!,
  position = document.querySelector<HTMLElement>("#position")!,
  notes = document.querySelector<HTMLElement>("#notes")!;
const state = new planView.State();
let cols = 110,
  rows = 34,
  narrow = false;
for (const entry of data) {
  const option = document.createElement("option");
  option.value = entry.key;
  option.textContent = `${entry.id} · ${entry.ablation} · ${entry.model}`;
  session.append(option);
}
const current = () => data.find(c => c.key === session.value)!;
const view = () => current().checkpoints[Number(slider.value)].view;
const color = (name: string | null, fallback: palette.Token) =>
  name?.startsWith("#") ? name : `rgb(${palette.colors[(name ?? fallback) as palette.Token].join(",")})`;
function render() {
  cols = Math.max(30, Math.min(narrow ? 64 : 116, Math.floor((document.querySelector("#wrap")!.clientWidth - 2) / 9)));
  rows = cols < 55 ? 30 : 34;
  const out = new Writer();
  planView.draw(out, planView.geometry(cols, rows), current().id, view(), state);
  const fragment = document.createDocumentFragment();
  for (const row of grid(out.buffered(), cols, rows)) {
    const line = document.createElement("div");
    line.className = "screen-row";
    for (const [ch, fg, bg, bold] of row) {
      const cell = document.createElement("span");
      cell.textContent = ch;
      cell.style.color = color(fg, "text");
      cell.style.backgroundColor = color(bg, "bg");
      if (bold) cell.style.fontWeight = "700";
      line.append(cell);
    }
    fragment.append(line);
  }
  screen.replaceChildren(fragment);
  screen.style.width = `${cols * 9}px`;
  position.textContent = `${Number(slider.value) + 1}/${current().checkpoints.length} · event ${current().checkpoints[Number(slider.value)].through}`;
  notes.textContent = `${current().model} · ${current().ablation} · source ${current().source.slice(0, 12)} · ${current().failures.length ? "Eval findings: " + current().failures.join("; ") : "All reviewed assertions passed"}`;
}
function change() {
  state.clear();
  slider.max = String(current().checkpoints.length - 1);
  slider.value = slider.max;
  render();
}
function perform(action: Action) {
  switch (action.name) {
    case "plan-next":
      state.move(view(), 1);
      break;
    case "plan-prev":
      state.move(view(), -1);
      break;
    case "plan-toggle":
      state.toggle();
      break;
    case "plan-select":
      if (state.selected === action.value) state.toggle();
      else state.selected = String(action.value);
      break;
    case "plan-close":
      state.selected = "";
      break;
  }
  render();
}
screen.tabIndex = 0;
screen.addEventListener("keydown", e => {
  const input =
    (
      {
        ArrowDown: "down",
        ArrowUp: "up",
        ArrowLeft: "left",
        ArrowRight: "right",
        Enter: "\r",
        Escape: "\x1b",
      } as Record<string, string>
    )[e.key] ?? e.key;
  const action = planView.key(input);
  if (action) {
    e.preventDefault();
    perform(action);
  }
});
screen.addEventListener("click", e => {
  const r = screen.getBoundingClientRect();
  const id = planView.hit(
    planView.geometry(cols, rows),
    Math.floor((e.clientX - r.left) / 9),
    Math.floor((e.clientY - r.top) / 20),
    state,
    view(),
  );
  if (id) perform({ name: "plan-select", value: id });
  screen.focus({ preventScroll: true });
});
screen.addEventListener(
  "wheel",
  e => {
    e.preventDefault();
    perform({ name: e.deltaY > 0 ? "plan-next" : "plan-prev" });
  },
  { passive: false },
);
slider.addEventListener("input", render);
session.addEventListener("change", change);
window.addEventListener("resize", render);
document.querySelector("#narrow")!.addEventListener("click", () => {
  narrow = !narrow;
  render();
});
document.querySelector("#bumps")!.addEventListener("click", () => {
  const ids = view()
      .nodes.filter(n => n.bump)
      .map(n => n.id),
    at = ids.indexOf(state.selected);
  state.selected = ids[(at + 1) % ids.length] ?? state.selected;
  state.collapsed.clear();
  render();
});
document.querySelector("#ansi")!.addEventListener("click", () => {
  const out = new Writer();
  planView.draw(out, planView.geometry(cols, rows), current().id, view(), state);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out.buffered()], { type: "text/plain" }));
  a.download = "corgi-plan.ansi";
  a.click();
  URL.revokeObjectURL(a.href);
});
Object.assign(window, { planReview: { state, view, render } });
change();
