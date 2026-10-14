import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Transfer } from "../hooks/useTransfers";
import { TransferDrawer } from "./TransferDrawer";

function transfer(partial: Partial<Transfer>): Transfer {
  return {
    id: "t", direction: "upload", name: "a.mp4", destination: "media/vimeo/", total: 2_100_000_000,
    status: "running", done: 1_344_000_000, error: null, path: null, ...partial,
  };
}

const sample = [
  transfer({ id: "1" }),
  transfer({ id: "2", name: "raw.mov", status: "failed", error: { kind: "network", message: "Kelp couldn't reach the storage provider." } }),
  transfer({ id: "3", name: "thumb.jpg", direction: "download", status: "finished", path: "/Users/me/Downloads/thumb.jpg", total: 92_000, done: 92_000 }),
];

function renderDrawer(overrides: Partial<Parameters<typeof TransferDrawer>[0]> = {}) {
  const props = {
    transfers: sample,
    onCancel: vi.fn(),
    onReveal: vi.fn(),
    onClearFinished: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TransferDrawer {...props} />);
  return props;
}

describe("TransferDrawer", () => {
  it("groups transfers with counts and folds finished ones", async () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: /In progress 1/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Failed 1/ }).getAttribute("aria-expanded")).toBe("true");
    const finished = screen.getByRole("button", { name: /Finished 1/ });
    expect(finished.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("thumb.jpg")).toBeNull();
    await userEvent.click(finished);
    expect(screen.getByText("thumb.jpg")).toBeTruthy();
  });

  it("shows progress and lets you cancel a running transfer", async () => {
    const props = renderDrawer();
    expect(screen.getByText("64% · 1.3 GB of 2.1 GB")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel a.mp4" }));
    expect(props.onCancel).toHaveBeenCalledWith("1");
  });

  it("explains failures and offers Show in Finder for finished downloads", async () => {
    const props = renderDrawer();
    expect(screen.getByText("Kelp couldn't reach the storage provider.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Finished 1/ }));
    await userEvent.click(screen.getByRole("button", { name: "Show thumb.jpg in Finder" }));
    expect(props.onReveal).toHaveBeenCalledWith("/Users/me/Downloads/thumb.jpg");
  });

  it("has no M3 controls yet", () => {
    renderDrawer();
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("closes with Escape and clears finished transfers on request", async () => {
    const props = renderDrawer();
    await userEvent.click(screen.getByRole("button", { name: "Clear finished" }));
    expect(props.onClearFinished).toHaveBeenCalled();
    screen.getByRole("region", { name: "Transfers" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("closes with Escape without clicking inside first", async () => {
    const props = renderDrawer();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("never shows more than 100 percent", () => {
    renderDrawer({ transfers: [transfer({ done: 3_000_000_000 })] });
    expect(screen.getByText("100% · 3 GB of 2.1 GB")).toBeTruthy();
  });

  it("names the real download folder", async () => {
    renderDrawer({ transfers: [transfer({ id: "d", direction: "download", status: "finished", path: "/Users/me/Desktop/x.jpg" })] });
    await userEvent.click(screen.getByRole("button", { name: /Finished 1/ }));
    expect(screen.getByText("to Desktop")).toBeTruthy();
  });

  it("lists cancelled transfers under Finished", async () => {
    renderDrawer({ transfers: [transfer({ name: "gone.mp4", status: "cancelled" })] });
    await userEvent.click(screen.getByRole("button", { name: /Finished 1/ }));
    expect(screen.getByText("gone.mp4")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });
});
