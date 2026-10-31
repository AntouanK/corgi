import * as history from "./history";
import type { History, Tokens } from "./history";
import type { State } from "../../src/activity/plan";
export * from "../../src/activity/plan";

export function ledger(state: State, data: History, throughLine = Infinity) {
  const counts: Record<string, Tokens> = Object.fromEntries(state.nodes.map(n => [n.id, history.zero()]));
  let observed = history.zero(),
    unattributed = history.zero();
  const parents = new Map(state.nodes.map(n => [n.id, n.parent]));
  for (const receipt of data.receipts) {
    if (receipt.line > throughLine) continue;
    observed = history.add(observed, receipt.tokens);
    let id =
      receipt.event === null ? null : state.spans.find(s => s.from <= receipt.event! && s.to >= receipt.event!)?.node;
    if (!id) unattributed = history.add(unattributed, receipt.tokens);
    while (id) {
      counts[id] = history.add(counts[id], receipt.tokens);
      id = parents.get(id);
    }
  }
  return { counts, observed, unattributed, known: data.receipts.some(receipt => receipt.line <= throughLine) };
}
