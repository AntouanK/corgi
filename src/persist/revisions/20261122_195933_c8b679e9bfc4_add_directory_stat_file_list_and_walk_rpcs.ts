import type { Revision } from "../formats";

export const revision: Revision = {
  id: "c8b679e9bfc4",
  parent: "08e793e2e4fa",
  description: "Add directory stat, file list and walk RPCs",
  // RPC additions leave saved metadata unchanged.
  up: value => value,
  down: value => value,
};
