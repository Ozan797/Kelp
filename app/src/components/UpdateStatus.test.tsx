import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useUpdater } from "../hooks/useUpdater";
import { api } from "../lib/tauri";
import { UpdateStatus } from "./UpdateStatus";

type Updater = ReturnType<typeof useUpdater>;

const updater = (patch: Partial<Updater> = {}): Updater => ({
  ready: null,
  cardOpen: false,
  message: null,
  openCard: vi.fn(),
  closeCard: vi.fn(),
  dismiss: vi.fn(),
  checkNow: vi.fn(),
  restart: vi.fn(async () => undefined),
  ...patch,
});

const offered = { version: "0.2.0", notes: "Kelp now remembers where you were in each folder.", install: async () => undefined };

afterEach(() => vi.restoreAllMocks());

describe("UpdateStatus", () => {
  it("shows_nothing_without_an_update_or_message", () => {
    const { container } = render(<UpdateStatus updater={updater()} runningTransfers={0} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("shows_the_indicator_when_an_update_is_ready", async () => {
    const state = updater({ ready: offered });
    render(<UpdateStatus updater={state} runningTransfers={0} />);
    const button = screen.getByRole("button", { name: "Update ready, Kelp 0.2.0" });
    expect(button.textContent).toBe("Update ready");
    await userEvent.click(button);
    expect(state.openCard).toHaveBeenCalled();
  });

  it("the_card_shows_the_offered_version", () => {
    render(<UpdateStatus updater={updater({ ready: offered, cardOpen: true })} runningTransfers={0} />);
    const card = screen.getByRole("dialog", { name: "Kelp 0.2.0 is ready" });
    expect(card.textContent).toContain(offered.notes);
    expect(screen.getByRole("button", { name: "What's new" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Restart to update" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it("whats_new_opens_the_offered_version", async () => {
    const open = vi.spyOn(api, "openDocs").mockResolvedValue(undefined);
    render(<UpdateStatus updater={updater({ ready: offered, cardOpen: true })} runningTransfers={0} />);
    await userEvent.click(screen.getByRole("button", { name: "What's new" }));
    expect(open).toHaveBeenCalledWith("/whats-new/#0.2.0");
  });

  it("restart_passes_the_running_transfers", async () => {
    const state = updater({ ready: offered, cardOpen: true });
    render(<UpdateStatus updater={state} runningTransfers={3} />);
    await userEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    expect(state.restart).toHaveBeenCalledWith(3);
  });

  it("close_dismisses_the_update", async () => {
    const state = updater({ ready: offered, cardOpen: true });
    render(<UpdateStatus updater={state} runningTransfers={0} />);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(state.dismiss).toHaveBeenCalled();
  });

  it("escape_closes_the_card_and_returns_focus", async () => {
    const state = updater({ ready: offered, cardOpen: true });
    const { rerender } = render(<UpdateStatus updater={state} runningTransfers={0} />);
    await userEvent.keyboard("{Escape}");
    expect(state.closeCard).toHaveBeenCalled();
    rerender(<UpdateStatus updater={{ ...state, cardOpen: false }} runningTransfers={0} />);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Update ready, Kelp 0.2.0" }));
  });

  it("a_message_card_has_only_close", async () => {
    const state = updater({ message: "Kelp is up to date (0.1.0).", cardOpen: true });
    render(<UpdateStatus updater={state} runningTransfers={0} />);
    expect(screen.getByText("Kelp is up to date (0.1.0).")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "What's new" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Restart to update" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(state.closeCard).toHaveBeenCalled();
  });
});
