import { Stdio } from "../../src/providers/stdio";
import { field, number, str } from "../../src/providers/common";
import type { Tokens } from "../../src/usage/live";

/** Record final provider receipts, not repeated partial assistant usage or cumulative modelUsage. */
export class Audit {
  receipts: unknown[] = [];
  original = Stdio.prototype.read;
  constructor() {
    const audit = this;
    Stdio.prototype.read = function () {
      const messages = audit.original.call(this);
      for (const message of messages)
        if (str(message, "type") === "result") audit.receipts.push(field(message, "usage"));
      return messages;
    };
  }
  take(tokens: Tokens) {
    const receipts = this.receipts.splice(0);
    if (!receipts.length) throw Error("MissingUsageReceipt");
    let input = 0n,
      cached = 0n,
      output = 0n,
      thinking = 0n,
      writes = 0n,
      regular = 0n;
    let known = receipts.length > 0;
    for (const usage of receipts) {
      input += number(usage, "input_tokens") ?? 0n;
      cached += number(usage, "cache_read_input_tokens") ?? 0n;
      writes += number(usage, "cache_creation_input_tokens") ?? 0n;
      output += number(usage, "output_tokens") ?? 0n;
      const detail = number(field(usage, "output_tokens_details"), "thinking_tokens");
      if (detail === null) known = false;
      else thinking += detail;
    }
    regular = input;
    input += cached + writes;
    if (input !== tokens.input || cached !== tokens.cached_input || output !== tokens.output || thinking > output)
      throw Error("UsageAuditMismatch");
    return {
      uncached_input: input - cached,
      regular_input: regular,
      cache_write_input: writes,
      cache_read_input: cached,
      output,
      thinking: known ? thinking : null,
      receipts,
    };
  }
  close() {
    Stdio.prototype.read = this.original;
  }
}
