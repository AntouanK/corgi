import type { Revision } from "../formats";

export const revision: Revision = {
  id: "b65e8f697017",
  parent: "08e793e2e4fa",
  description: "Add pane.view and a pane's viewer-shown file",
  // An RPC and a snapshot field leave saved metadata unchanged.
  up: value => value,
  down: value => value,
};
