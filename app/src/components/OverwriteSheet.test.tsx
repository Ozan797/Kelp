import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { OverwriteSheet } from "./OverwriteSheet";

const plan = {
  files: 1204,
  bytes: 9_800_000_000,
  existing: 38,
  examples: ["2026/photos/IMG_0001.jpg", "2026/photos/IMG_0002.jpg", "2026/photos/raw/IMG_0001.dng"],
};

function renderSheet(overrides: Partial<Parameters<typeof OverwriteSheet>[0]> = {}) {
  const props = {
    plan,
    folderName: "photos",
    destination: "media-archive/2026/",
    onCancel: vi.fn(),
    onSkip: vi.fn(),
    onReplace: vi.fn(),
    ...overrides,
  };
  render(<OverwriteSheet {...props} />);
  return props;
}

describe("OverwriteSheet", () => {
  it("says how many files clash and shows a few of them", () => {
    renderSheet();
    expect(screen.getByRole("dialog", { name: "38 of 1,204 files are already here" })).toBeTruthy();
    expect(screen.getByText('Uploading "photos" to media-archive/2026/ would replace them.')).toBeTruthy();
    expect(screen.getByText("2026/photos/raw/IMG_0001.dng")).toBeTruthy();
    expect(screen.getByText("and 35 more")).toBeTruthy();
  });

  it("names every button after what it does", async () => {
    const props = renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "Replace 38 files" }));
    expect(props.onReplace).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Skip 38 existing" }));
    expect(props.onSkip).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalled();
  });

  it("skips on Return and cancels on Escape, never replacing by accident", async () => {
    const props = renderSheet();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Skip 38 existing" }));
    await userEvent.keyboard("{Enter}");
    expect(props.onSkip).toHaveBeenCalledTimes(1);
    await userEvent.keyboard("{Escape}");
    expect(props.onCancel).toHaveBeenCalledTimes(1);
    expect(props.onReplace).not.toHaveBeenCalled();
  });

  it("uses the singular for one file", () => {
    renderSheet({ plan: { files: 3, bytes: 3, existing: 1, examples: ["2026/photos/a.jpg"] } });
    expect(screen.getByRole("dialog", { name: "1 of 3 files is already here" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Replace 1 file" })).toBeTruthy();
    expect(screen.queryByText(/more$/)).toBeNull();
  });
});
