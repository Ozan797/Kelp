import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { UsageView } from "../lib/tauri";
import { StatusBar } from "./StatusBar";

const NOW = 1_000_000_000;

function usage(partial: Partial<UsageView>): UsageView {
  return {
    connectionId: "c1",
    bucket: "media",
    prefix: "2026/",
    bytes: 0,
    objects: 0,
    countedAtMs: NOW,
    complete: false,
    resumeToken: null,
    counting: false,
    ...partial,
  };
}

function renderBar(view: UsageView | null) {
  const size = { usage: view, now: NOW, onCalculate: vi.fn(), onCancel: vi.fn() };
  render(<StatusBar itemCount={3} selectedCount={0} selectedBytes={0} transfers={[]} onOpenTransfers={vi.fn()} size={size} />);
  return size;
}

describe("StatusBar size", () => {
  it("offers to calculate a size that was never counted", async () => {
    const size = renderBar(null);
    expect(screen.getByText("3 items")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Calculate size" }));
    expect(size.onCalculate).toHaveBeenCalled();
  });

  it("shows live progress while counting, with Cancel", async () => {
    const size = renderBar(usage({ counting: true, bytes: 812_000_000_000, objects: 2_400_000 }));
    expect(screen.getByText("Counting · 2.4 M files · 812 GB so far")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(size.onCancel).toHaveBeenCalled();
  });

  it("shows a finished size with its age and Recalculate", async () => {
    const size = renderBar(usage({ complete: true, bytes: 1_200_000_000_000, objects: 3_100_000, countedAtMs: NOW - 3 * 3_600_000 }));
    expect(screen.getByText("1.2 TB · 3.1 M files · 3 h ago")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    expect(size.onCalculate).toHaveBeenCalled();
  });

  it("offers to continue an interrupted count", async () => {
    const size = renderBar(usage({ bytes: 812_000_000_000, objects: 2_400_000, resumeToken: "t" }));
    expect(screen.getByText("812 GB counted so far")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(size.onCalculate).toHaveBeenCalled();
  });
});
