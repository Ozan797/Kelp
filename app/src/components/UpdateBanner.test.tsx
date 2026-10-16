import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { UpdateBanner } from "./UpdateBanner";

const ready = { kind: "ready" as const, update: { version: "0.2.0", notes: "Faster previews", install: async () => undefined } };
const handlers = () => ({ onRestart: vi.fn(), onLater: vi.fn(), onClose: vi.fn() });

describe("UpdateBanner", () => {
  it("shows nothing when idle", () => {
    const { container } = render(<UpdateBanner state={{ kind: "idle" }} {...handlers()} />);
    expect(container.textContent).toBe("");
  });

  it("offers a ready update with notes on request", async () => {
    const on = handlers();
    render(<UpdateBanner state={ready} {...on} />);
    expect(screen.getByRole("status").textContent).toContain("Kelp 0.2.0 is ready. Restart to update.");
    expect(screen.queryByText("Faster previews")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Release notes" }));
    expect(screen.getByText("Faster previews")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    await userEvent.click(screen.getByRole("button", { name: "Restart" }));
    expect(on.onLater).toHaveBeenCalled();
    expect(on.onRestart).toHaveBeenCalled();
  });

  it("hides Release notes when there are none", () => {
    render(<UpdateBanner state={{ kind: "ready", update: { ...ready.update, notes: "" } }} {...handlers()} />);
    expect(screen.queryByRole("button", { name: "Release notes" })).toBeNull();
  });

  it("shows a message with a Close button", async () => {
    const on = handlers();
    render(<UpdateBanner state={{ kind: "message", text: "Kelp is up to date (0.2.0)." }} {...on} />);
    expect(screen.getByRole("status").textContent).toContain("Kelp is up to date (0.2.0).");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(on.onClose).toHaveBeenCalled();
  });
});
