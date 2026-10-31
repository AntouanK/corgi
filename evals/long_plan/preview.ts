#!/usr/bin/env bun
import * as fs from "node:fs";
import * as path from "node:path";
import * as plan from "./plan";
import * as roadmap from "../../src/activity/roadmap";
import * as palette from "../../src/palette";
import type { History } from "./history";

const replays = new Map();
for (const directory of process.argv.slice(2)) {
  const report = JSON.parse(fs.readFileSync(path.join(directory, "report.json"), "utf8"));
  const reviewPath = path.join(directory, "review.json"),
    review = fs.existsSync(reviewPath) ? JSON.parse(fs.readFileSync(reviewPath, "utf8")) : report;
  for (const result of report.cases) {
    const scored = review.cases.find((c: { id: string }) => c.id === result.id) ?? result;
    const history: History = JSON.parse(fs.readFileSync(path.join(directory, `${result.id}.history.json`), "utf8"));
    const calls = JSON.parse(fs.readFileSync(path.join(directory, `${result.id}.calls.json`), "utf8"));
    const checkpoints = calls
      .filter((c: { state?: plan.State }) => c.state)
      .map((c: { state: plan.State; through: number }) => {
        const ledger = plan.ledger(c.state, history, history.events.find(e => e.id === c.through)?.line ?? 0);
        const counts: Record<string, roadmap.Counts> = Object.fromEntries(
          c.state.nodes.map(n => [n.id, { ...ledger.counts[n.id], tools: "0" }]),
        );
        let unassignedTools = 0n;
        const parents = new Map(c.state.nodes.map(n => [n.id, n.parent]));
        for (const event of history.events) {
          if (event.id > c.through || (event.kind !== "tool" && event.kind !== "plan")) continue;
          let id = c.state.spans.find(s => s.from <= event.id && s.to >= event.id)?.node;
          if (!id) unassignedTools++;
          while (id) {
            counts[id].tools = String(BigInt(counts[id].tools!) + 1n);
            id = parents.get(id);
          }
        }
        const view: roadmap.Snapshot = {
          nodes: c.state.nodes,
          counts,
          unassigned: { ...ledger.unattributed, tools: String(unassignedTools) },
          known: ledger.known,
          partial: history.warnings.length > 0,
          limited: false,
        };
        return { through: c.through, view };
      });
    if (checkpoints.length)
      replays.set(`${path.basename(directory)}/${result.id}`, {
        key: `${path.basename(directory)}/${result.id}`,
        id: result.id,
        ablation: report.ablation,
        source: result.source_hash,
        model: report.model,
        checkpoints,
        failures: [
          ...scored.errors,
          ...scored.checks.filter((c: { pass: boolean }) => !c.pass).map((c: { name: string }) => c.name),
        ],
      });
  }
}
if (!replays.size) throw Error("Provide completed replay directories");
const built = await Bun.build({
  entrypoints: [path.join(import.meta.dir, "preview_browser.ts")],
  target: "browser",
  minify: true,
});
if (!built.success) throw Error(built.logs.join("\n"));
const js = await built.outputs[0].text();
const css = Object.entries(palette.colors)
  .map(([k, v]) => `--${k}:rgb(${v.join(",")})`)
  .join(";");
const data = JSON.stringify([...replays.values()]).replaceAll("<", "\\u003c");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Corgi · Long-term plan</title><style>:root{${css}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui}main{max-width:1080px;margin:36px auto;padding:0 12px}h1{color:var(--strong);font-size:32px;margin:8px 0}p{color:var(--muted);max-width:850px}.eyebrow{color:var(--accent);font:12px monospace;letter-spacing:.12em}.controls{display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin:18px 0}select,button{min-height:36px;max-width:100%;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:6px 12px}input{flex:1;min-width:110px;accent-color:var(--accent)}#screen{font:14px/20px ui-monospace,"DejaVu Sans Mono",monospace;outline:none;margin:0 auto}#screen:focus{box-shadow:0 0 0 1px var(--accent)}.screen-row{height:20px;white-space:pre}.screen-row span{display:inline-block;width:9px;height:20px}#wrap{overflow:auto;border:1px solid var(--line);border-radius:8px}.facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;margin:22px 0}.facts p{font-size:13px}#notes{font:12px/1.5 monospace;overflow-wrap:anywhere;color:var(--faint)}@media(max-width:650px){main{margin:18px auto}.facts{grid-template-columns:1fr;gap:0}h1{font-size:26px}}</style><main><div class="eyebrow">CORGI / WORKTREE DESIGN REVIEW</div><h1>Long-term plan, in Corgi.</h1><p>The actual terminal panel, driven by recorded development conversations and synthetic probes. One row per item, with episodes and their steps. The goal stays in the header. Try “Long example”, scroll inside the panel, or use Page Down and End to inspect work beyond the viewport.</p><div class="controls"><label for="session">Replay</label><select id="session"></select><button id="narrow">Narrow view</button><button id="bumps">Next !</button><button id="long">Long example</button><label for="height">Height</label><select id="height"><option value="18">18 rows</option><option value="24" selected>24 rows</option><option value="34">34 rows</option><option value="50">50 rows</option></select><button id="ansi">Export ANSI</button></div><div class="controls"><label for="checkpoint">Checkpoint</label><input id="checkpoint" type="range" min="0"><output id="position"></output></div><div id="wrap"><div id="screen" aria-label="Corgi plan panel"></div></div><div class="facts"><div><strong>Keep the whole episode</strong><p>Goals survive turns. Reading, edits and retries sit under the subproblem they address.</p></div><div><strong>Keep problems visible</strong><p>A green ▶ means running; future work is labeled planned. ! marks a problem only on the affected step. Resolved problems and completed work are dimmed. A checked TODO is intent, not verification.</p></div><div><strong>Show what was observed</strong><p>Tokens include cached input once. Episode attribution is inferred; unassigned usage stays visible. Live Corgi counts observed intervals only.</p></div></div><p id="notes"></p><p>Worktree preview: <code>CORGI_LONG_PLAN=1 ./go.ts --env long-plan --no-kill</code>. Select an agent and use <code>prefix P</code>, or “Long-term plan” in the command menu. The feature remains opt-in while eval failures are addressed.</p></main><script id="data" type="application/json">${data}</script><script type="module">${js.replaceAll("</script", "<\\/script")}</script></html>`;
fs.mkdirSync(".lavish", { recursive: true });
fs.writeFileSync(".lavish/long-plan-integrated.html", html);
console.log(`${replays.size} replays → .lavish/long-plan-integrated.html`);
