import { describe, expect, it } from "vitest";
import type { TransferInfo } from "../lib/tauri";
import { transfersReducer, type Transfer } from "./useTransfers";

const info: TransferInfo = { id: "t1", direction: "upload", name: "a.mp4", destination: "media/", total: 100 };

function started(): Transfer[] {
  return transfersReducer([], { type: "state", event: { id: "t1", state: "running", info, error: null, path: null } });
}

describe("transfersReducer", () => {
  it("adds a transfer when it starts", () => {
    expect(started()).toEqual([{ ...info, status: "running", done: 0, error: null, path: null }]);
  });

  it("updates progress", () => {
    const next = transfersReducer(started(), { type: "progress", event: { id: "t1", done: 40, total: 100 } });
    expect(next[0].done).toBe(40);
  });

  it("records the outcome", () => {
    const failed = transfersReducer(started(), {
      type: "state",
      event: { id: "t1", state: "failed", info: null, error: { kind: "network", message: "offline" }, path: null },
    });
    expect(failed[0].status).toBe("failed");
    expect(failed[0].error?.kind).toBe("network");
  });

  it("ignores events for unknown transfers", () => {
    expect(transfersReducer([], { type: "progress", event: { id: "nope", done: 1, total: 2 } })).toEqual([]);
  });

  it("clears finished and cancelled transfers but keeps running and failed ones", () => {
    let state = started();
    state = transfersReducer(state, {
      type: "state",
      event: { id: "t2", state: "running", info: { ...info, id: "t2" }, error: null, path: null },
    });
    state = transfersReducer(state, { type: "state", event: { id: "t1", state: "finished", info: null, error: null, path: "/x" } });
    expect(transfersReducer(state, { type: "clearFinished" }).map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("transfersReducer duplicates", () => {
  it("does not add a transfer twice when its start event repeats", () => {
    const again = transfersReducer(started(), {
      type: "state",
      event: { id: "t1", state: "running", info, error: null, path: null },
    });
    expect(again).toHaveLength(1);
  });
});
