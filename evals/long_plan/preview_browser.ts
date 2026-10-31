import * as planView from "../../src/plan_view";
import * as palette from "../../src/palette";
import * as roadmap from "../../src/activity/roadmap";
import { Writer } from "../../src/text";
import { grid } from "../../site/terminal";

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
const height = document.querySelector<HTMLSelectElement>("#height")!;
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
  rows = Number(height.value);
  const out = new Writer();
  planView.draw(out, planView.geometry(cols, rows), current().id, view());
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
  slider.max = String(current().checkpoints.length - 1);
  slider.value = slider.max;
  render();
}
screen.tabIndex = 0;
screen.addEventListener("keydown", e => {
  if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", "Enter", " "].includes(e.key)) e.preventDefault();
});
slider.addEventListener("input", render);
session.addEventListener("change", change);
height.addEventListener("change", render);
window.addEventListener("resize", render);
document.querySelector("#long")!.addEventListener("click", () => {
  session.value = data.toSorted(
    (a, b) => b.checkpoints.at(-1)!.view.nodes.length - a.checkpoints.at(-1)!.view.nodes.length,
  )[0].key;
  height.value = "18";
  change();
  screen.focus({ preventScroll: true });
});
document.querySelector("#narrow")!.addEventListener("click", () => {
  narrow = !narrow;
  render();
});
document.querySelector("#ansi")!.addEventListener("click", () => {
  const out = new Writer();
  planView.draw(out, planView.geometry(cols, rows), current().id, view());
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out.buffered()], { type: "text/plain" }));
  a.download = "corgi-plan.ansi";
  a.click();
  URL.revokeObjectURL(a.href);
});
Object.assign(window, { planReview: { view, render } });
change();
