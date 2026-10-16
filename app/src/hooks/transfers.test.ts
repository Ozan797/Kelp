import { describe, expect, it } from "vitest";
import type { TransferView } from "../lib/tauri";
import { transfersReducer, type Transfer } from "./useTransfers";

function view(partial: Partial<TransferView> = {}): TransferView {
  return {
    id: "t1",
    direction: "upload",
    kind: "file",
    name: "a.mp4",
    destination: "media/",
    status: "running",
    retryAt: null,
    total: 100,
    done: 0,
    filesTotal: 1,
    filesDone: 0,
    filesFailed: 0,
    error: null,
    path: null,
    moving: false,
    ...partial,
  };
}

function started(): Transfer[] {
  return transfersReducer([], { type: "state", view: view() });
}

describe("transfersReducer", () => {
  it("adds a transfer the first time it is seen", () => {
    expect(started()).toEqual([{ ...view(), speed: null, sample: null }]);
  });

  it("replaces a known transfer with its newest view", () => {
    const paused = transfersReducer(started(), { type: "state", view: view({ status: "paused", done: 40 }) });
    expect(paused).toHaveLength(1);
    expect(paused[0].status).toBe("paused");
    expect(paused[0].done).toBe(40);
  });

  it("updates progress and works out the speed", () => {
    let state = transfersReducer(started(), { type: "progress", event: { id: "t1", done: 10, total: 100, filesDone: 0 }, at: 1000 });
    expect(state[0].done).toBe(10);
    expect(state[0].speed).toBeNull();
    state = transfersReducer(state, { type: "progress", event: { id: "t1", done: 30, total: 100, filesDone: 0 }, at: 2000 });
    expect(state[0].speed).toBe(20);
  });

  it("forgets the speed once a transfer stops running", () => {
    let state = transfersReducer(started(), { type: "progress", event: { id: "t1", done: 10, total: 100, filesDone: 0 }, at: 1000 });
    state = transfersReducer(state, { type: "progress", event: { id: "t1", done: 30, total: 100, filesDone: 0 }, at: 2000 });
    state = transfersReducer(state, { type: "state", view: view({ status: "paused", done: 30 }) });
    expect(state[0].speed).toBeNull();
  });

  it("shows a finished transfer as complete", () => {
    const finished = transfersReducer(started(), { type: "state", view: view({ status: "finished", done: 60 }) });
    expect(finished[0].done).toBe(100);
  });

  it("ignores progress for unknown transfers", () => {
    expect(transfersReducer([], { type: "progress", event: { id: "nope", done: 1, total: 2, filesDone: 0 }, at: 0 })).toEqual([]);
  });

  it("adds transfers saved from last time without duplicating live ones", () => {
    const state = transfersReducer(started(), { type: "loaded", views: [view({ status: "waiting" }), view({ id: "t2", status: "paused" })] });
    expect(state.map((t) => [t.id, t.status])).toEqual([
      ["t1", "running"],
      ["t2", "paused"],
    ]);
  });

  it("clears finished and cancelled transfers but keeps the rest", () => {
    let state = started();
    for (const [id, status] of [
      ["t2", "waiting"],
      ["t3", "paused"],
      ["t4", "failed"],
      ["t5", "finished"],
      ["t6", "cancelled"],
      ["t7", "retrying"],
    ] as const) {
      state = transfersReducer(state, { type: "state", view: view({ id, status }) });
    }
    expect(transfersReducer(state, { type: "clearFinished" }).map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4", "t7"]);
  });
});
