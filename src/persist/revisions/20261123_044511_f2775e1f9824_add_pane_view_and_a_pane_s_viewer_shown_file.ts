import type { Revision } from "../formats";

export const revision: Revision = {
  id: "f2775e1f9824",
  parent: "1047006f32d4",
  description: "Add pane.view and a pane's viewer-shown file",
  // An RPC and a snapshot field leave saved metadata unchanged.
  up: value => value,
  down: value => value,
};
