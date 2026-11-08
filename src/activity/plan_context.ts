import * as protocol from "./plan_protocol";
import type { State } from "./plan";
import type { Input } from "./roadmap";
import type { Request } from "../inference/harness";

const signature = (state: State) => JSON.stringify([state.through, state.nodes]);

/** Accepted state is authoritative. Missing conversations always receive a complete seed. */
export class Context {
  constructor(private readonly wire: Pick<Request, "instructions" | "schema"> = protocol) {}
  private previous: Input | null = null;
  private expected = "";
  private key = "";
  private turns = 0;
  invalidate() {
    this.previous = null;
  }
  prepare(input: Input): Request {
    if (!this.previous || this.expected !== signature(input.state) || this.turns >= 16) {
      this.previous = null;
      this.key = "plan:" + crypto.randomUUID();
      this.turns = 0;
    }
    const fresh = protocol.content(input);
    let content = fresh;
    if (this.previous) {
      const nodes = new Map(this.previous.state.nodes.map(n => [n.id, JSON.stringify(n)])),
        support = new Map([...this.previous.support, ...this.previous.events].map(e => [e.id, e.text]));
      content = JSON.stringify({
        tree_updates: input.state.nodes
          .filter(n => n.kind !== "step" || n.bump?.state === "open" || nodes.get(n.id) !== JSON.stringify(n))
          .map(protocol.node),
        support: input.support.filter(e => !support.get(e.id)?.startsWith(e.text)).map(protocol.event),
        focus: protocol.focus(input),
        range: [input.events[0].id, input.events.at(-1)!.id],
        events: input.events.map(protocol.event),
      });
    }
    return {
      instructions: this.wire.instructions,
      schema: this.wire.schema,
      content,
      fresh_content: fresh,
      conversation: this.key,
    };
  }
  accept(input: Input, state: State) {
    this.previous = structuredClone(input);
    this.expected = signature(state);
    this.turns++;
  }
}
