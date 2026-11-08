import { Pool } from "./inference/harness";
import { model } from "./inference/setup";
import type { Provider } from "./providers";
import { getLogger } from "./log";
import * as contract from "./activity/prompt";
import type { Input as RoadInput } from "./activity/roadmap";
import * as plan_protocol from "./activity/plan_protocol";
import { Context } from "./activity/plan_context";
import { Text } from "./agents";
const log = getLogger("activity_summary");
export { contract };
export type Input = contract.Input;
export type Source = {
  actor: number;
  panes: number[];
  agent_name: string;
  session: string;
  tools_since_last: bigint;
};
export type Discard = "not_working" | "session_changed" | "turn_changed" | "evidence_changed" | "superseded";
export function outcome(request: bigint, discard: Discard | null) {
  if (!request) return;
  log.info("Summary outcome", {
    event: "outcome",
    context: { pid: process.pid, request },
    status: discard === null ? "applied" : "discarded",
    reason: discard,
  });
}
export class Backend {
  pool = new Pool();
  next_request = 0n;
  private plans = new Map<string, Context>();
  use(provider: Provider | null, selected = model(provider), account = "") {
    this.close();
    this.pool.started = false;
    this.pool.config.disabled = provider === null;
    if (provider) this.pool.config.provider = provider;
    this.pool.config.model = selected || null;
    this.pool.config.account = account;
    this.pool.config.executable = process.env.CORGI_INFERENCE_BIN ?? null;
  }
  close() {
    this.pool.close();
    this.plans.clear();
  }
  private planContext(key: string) {
    const context = this.plans.get(key) ?? new Context();
    this.plans.delete(key);
    this.plans.set(key, context);
    if (this.plans.size > 4) this.plans.delete(this.plans.keys().next().value!);
    return context;
  }
  async infer(
    input: Input,
    turn: string,
    conversation: string,
    source: Source,
    stopping: any = false,
    road: RoadInput | null = null,
  ) {
    const request = ++this.next_request,
      context = { pid: process.pid, request, source, turn, conversation };
    const roadContext = road ? this.planContext(conversation) : null,
      inference =
        road && roadContext
          ? roadContext.prepare(road)
          : {
              instructions: contract.instructions,
              schema: contract.schema,
              content: contract.content({ ...input, history: null }),
              fresh_content: input.history?.length ? contract.content(input) : null,
              conversation,
            };
    const { content, fresh_content: fresh, instructions, schema } = inference;
    log.info("Summary requested", {
      event: "request",
      context,
      provider: this.pool.config.provider,
      model: this.pool.config.model,
      instructions,
      schema,
      input: content,
      fresh_input: fresh,
    });
    let response;
    try {
      response = await this.pool.infer(inference, stopping);
    } catch (error) {
      roadContext?.invalidate();
      log.info("Summary inference failed", {
        event: "result",
        context,
        status: "inference_error",
        err: (error as Error).message,
        output: null,
      });
      return { request, decision: null };
    }
    try {
      let patch: string | null = null;
      let decision: { action: contract.Action; label: Text | null };
      if (road) {
        const applied = plan_protocol.apply(road, response.text());
        roadContext!.accept(road, applied.state);
        patch = JSON.stringify(applied.patch);
        const id = applied.patch.spans.at(-1)?.node,
          current = applied.state.nodes.find(n => n.id === id);
        decision = { action: "new", label: current ? new Text(current.title) : null };
      } else decision = contract.parse(response.text(), input.phase);
      log.info("Summary result", {
        event: "result",
        context,
        status: decision.label === null ? "abstained" : "validated",
        output: response.text(),
        action: decision.action,
        label: decision.label?.text() ?? null,
        fresh_conversation: response.fresh,
        usage: response.usage,
      });
      return { request, decision, patch };
    } catch (error) {
      roadContext?.invalidate();
      log.info("Summary rejected", {
        event: "result",
        context,
        status: "rejected",
        err: (error as Error).message,
        output: response.text(),
        fresh_conversation: response.fresh,
        usage: response.usage,
      });
      return { request, decision: null };
    }
  }
}
