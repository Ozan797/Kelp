import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsSheet } from "./SettingsSheet";

describe("SettingsSheet", () => {
  it("shows the appearance choice and changes it at once", async () => {
    const onTheme = vi.fn();
    render(<SettingsSheet theme="system" onTheme={onTheme} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Saved on this Mac.")).toBeTruthy();
    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(group).toBeTruthy();
    expect((screen.getByRole("radio", { name: "System" }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(onTheme).toHaveBeenCalledWith("dark");
  });

  it("keeps Tab inside the sheet", async () => {
    render(<SettingsSheet theme="light" onTheme={vi.fn()} onClose={vi.fn()} />);
    const done = screen.getByRole("button", { name: "Done" });
    expect(document.activeElement).toBe(done);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Light" }));
    await userEvent.tab({ shift: true });
    expect(document.activeElement).toBe(done);
  });

  it("closes with Done or Escape", async () => {
    const onClose = vi.fn();
    render(<SettingsSheet theme="light" onTheme={vi.fn()} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
