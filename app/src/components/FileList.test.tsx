import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Row } from "../hooks/useListing";
import { FileList, filterRows, nextSelection, sortRows, type Sort } from "./FileList";

const folder = (name: string): Row => ({ key: `${name}/`, name, isFolder: true, size: null, lastModified: null });
const file = (name: string, size: number): Row => ({ key: name, name, isFolder: false, size, lastModified: null });

describe("sortRows", () => {
  it("keeps folders first and sorts within each group", () => {
    const rows = [file("b.txt", 5), folder("zeta"), file("a.txt", 50), folder("alpha")];
    expect(sortRows(rows, { key: "name", ascending: true }).map((r) => r.name)).toEqual(["alpha", "zeta", "a.txt", "b.txt"]);
    expect(sortRows(rows, { key: "size", ascending: false }).map((r) => r.name)).toEqual(["alpha", "zeta", "a.txt", "b.txt"]);
    expect(sortRows(rows, { key: "name", ascending: false }).map((r) => r.name)).toEqual(["zeta", "alpha", "b.txt", "a.txt"]);
  });

  it("sorts names the way people expect numbers to sort", () => {
    const rows = [file("file10.txt", 1), file("file2.txt", 1)];
    expect(sortRows(rows, { key: "name", ascending: true }).map((r) => r.name)).toEqual(["file2.txt", "file10.txt"]);
  });
});

describe("filterRows", () => {
  it("matches part of the name, ignoring case", () => {
    expect(filterRows([file("Teaser.mp4", 1), file("notes.md", 1)], "TEAS").map((r) => r.name)).toEqual(["Teaser.mp4"]);
    expect(filterRows([file("a", 1)], "   ")).toHaveLength(1);
  });
});

describe("nextSelection", () => {
  const ordered = ["a", "b", "c", "d"];
  it("replaces, toggles and extends", () => {
    expect([...nextSelection(new Set(["a"]), ordered, "c", "replace", "a")]).toEqual(["c"]);
    expect([...nextSelection(new Set(["a"]), ordered, "c", "toggle", "a")].sort()).toEqual(["a", "c"]);
    expect([...nextSelection(new Set(["a", "c"]), ordered, "c", "toggle", "a")]).toEqual(["a"]);
    expect([...nextSelection(new Set(["b"]), ordered, "d", "range", "b")]).toEqual(["b", "c", "d"]);
    expect([...nextSelection(new Set(), ordered, "c", "range", null)]).toEqual(["c"]);
  });
});

function Harness({
  rows,
  filter = "",
  onOpen = vi.fn(),
  onGoUp = vi.fn(),
  dropKey = null,
}: {
  rows: Row[];
  filter?: string;
  onOpen?: (row: Row) => void;
  onGoUp?: () => void;
  dropKey?: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<Sort>({ key: "name", ascending: true });
  return (
    <FileList
      rows={rows}
      filter={filter}
      sort={sort}
      onSort={setSort}
      selected={selected}
      onSelectionChange={setSelected}
      onOpen={onOpen}
      onGoUp={onGoUp}
      onContextMenu={vi.fn()}
      hasMore={false}
      loading={false}
      onLoadMore={vi.fn()}
      dropKey={dropKey}
    />
  );
}

const originalHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const originalWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 800 });
});

afterAll(() => {
  if (originalHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalHeight);
  if (originalWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", originalWidth);
});

describe("FileList", () => {
  it("shows rows with sizes and selects with click, ⌘-click and ⇧-click", async () => {
    render(<Harness rows={[file("a.txt", 1500), file("b.txt", 1), file("c.txt", 1)]} />);
    expect(screen.getByText("1.5 KB")).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByText("a.txt"));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByText("c.txt"));
    await user.keyboard("{/Shift}");
    expect(screen.getAllByRole("row", { selected: true })).toHaveLength(3);
  });

  it("opens a folder on double-click", async () => {
    const onOpen = vi.fn();
    render(<Harness rows={[folder("2025")]} onOpen={onOpen} />);
    await userEvent.dblClick(screen.getByText("2025"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "2025/" }));
  });

  it("keeps the selection and applies the filter when more rows arrive", async () => {
    const first = [file("teaser.mp4", 1), file("notes.md", 1)];
    const { rerender } = render(<Harness rows={first} filter="" />);
    await userEvent.click(screen.getByText("teaser.mp4"));
    rerender(<Harness rows={[...first, file("teaser-2.mp4", 1), file("credits.txt", 1)]} filter="teaser" />);
    expect(screen.getAllByRole("row", { selected: true }).map((row) => row.textContent)).toEqual([
      expect.stringContaining("teaser.mp4"),
    ]);
    expect(screen.queryByText("credits.txt")).toBeNull();
    expect(screen.getByText("teaser-2.mp4")).toBeTruthy();
  });

  it("opens the focused folder with Enter and goes up with Backspace or ⌘↑", async () => {
    const onOpen = vi.fn();
    const onGoUp = vi.fn();
    render(<Harness rows={[folder("2025"), file("a.txt", 1)]} onOpen={onOpen} onGoUp={onGoUp} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("grid"));
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: "2025/" }));
    await user.keyboard("{Backspace}");
    await user.keyboard("{Meta>}{ArrowUp}{/Meta}");
    expect(onGoUp).toHaveBeenCalledTimes(2);
  });

  it("moves the selection with arrow keys and selects everything with ⌘A", async () => {
    render(<Harness rows={[file("a.txt", 1), file("b.txt", 1), file("c.txt", 1)]} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("a.txt"));
    await user.keyboard("{ArrowDown}");
    expect(screen.getAllByRole("row", { selected: true }).map((row) => row.textContent)).toEqual([
      expect.stringContaining("b.txt"),
    ]);
    await user.keyboard("{Meta>}a{/Meta}");
    expect(screen.getAllByRole("row", { selected: true })).toHaveLength(3);
  });

  it("fades in only the first rows of the first page", () => {
    const firstPage = Array.from({ length: 20 }, (_, i) => file(`f${String(i).padStart(2, "0")}.txt`, 1));
    const { rerender } = render(<Harness rows={firstPage} />);
    const introduced = () => screen.getAllByRole("row", { selected: false }).filter((row) => row.classList.contains("intro"));
    expect(introduced().map((row) => row.textContent?.slice(0, 7))).toEqual(firstPage.slice(0, 12).map((r) => r.name));
    rerender(<Harness rows={[...firstPage, file("a-late.txt", 1)]} />);
    expect(introduced()).toHaveLength(0);
  });

  it("stops fading rows in once the list scrolls", () => {
    render(<Harness rows={[file("a.txt", 1), file("b.txt", 1)]} />);
    expect(screen.getAllByRole("row", { selected: false })[0].classList.contains("intro")).toBe(true);
    fireEvent.scroll(screen.getByRole("grid"));
    expect(document.querySelector(".file-row.intro")).toBeNull();
  });
});

describe("FileList drop targets", () => {
  it("marks folder rows as drop targets and highlights the one under the pointer", () => {
    render(<Harness rows={[folder("drafts"), folder("2024"), file("a.txt", 1)]} dropKey="drafts/" />);
    const drafts = screen.getByText("drafts").closest("[role=row]");
    expect(drafts?.getAttribute("data-drop")).toBe("folder");
    expect(drafts?.getAttribute("data-key")).toBe("drafts/");
    expect(drafts?.classList.contains("drop-target")).toBe(true);
    expect(screen.getByText("2024").closest("[role=row]")?.classList.contains("drop-target")).toBe(false);
    expect(screen.getByText("a.txt").closest("[role=row]")?.hasAttribute("data-drop")).toBe(false);
  });
});
