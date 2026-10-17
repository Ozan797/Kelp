import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, FileDropEvent, ListPage, MenuEntry, TransferView } from "./lib/tauri";
import App from "./App";
import { forgetRememberedFolders } from "./hooks/useListing";

const api = vi.hoisted(() => ({
  listConnections: vi.fn(),
  listBuckets: vi.fn(),
  listObjects: vi.fn(),
  setLastLocation: vi.fn(),
  onTransferState: vi.fn(),
  onTransferProgress: vi.fn(),
  listTransfers: vi.fn(),
  getUsage: vi.fn(),
  onUsageProgress: vi.fn(),
  startUsageCount: vi.fn(),
  cancelUsageCount: vi.fn(),
  confirm: vi.fn(),
  deleteObjects: vi.fn(),
  showContextMenu: vi.fn(),
  startDownload: vi.fn(),
  startFolderDownload: vi.fn(),
  pickFolder: vi.fn(),
  pickFiles: vi.fn(),
  planUpload: vi.fn(),
  startUploads: vi.fn(),
  inspectDrop: vi.fn(),
  onFileDrop: vi.fn(),
  planCopy: vi.fn(),
  startCopy: vi.fn(),
  getSettings: vi.fn(),
  setSettings: vi.fn(),
  setWindowTheme: vi.fn(),
  openDocs: vi.fn(),
  testConnection: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
  checkForUpdate: vi.fn(async () => null),
  appVersion: vi.fn(async () => "0.1.0"),
  restartApp: vi.fn(async () => undefined),
  onCheckForUpdates: vi.fn(async () => () => undefined),
  onWindowFocus: vi.fn(async () => () => undefined),
}));

vi.mock("./lib/tauri", () => ({
  api,
  toAppError: (value: unknown) => value,
}));

const media: ConnectionProfile = {
  id: "c1",
  name: "media",
  settings: { kind: "hetzner", endpoint: null, region: "hel1", pathStyle: false, accessKeyId: "AKID" },
  bucket: null,
  lastLocation: null,
};

const page = (folders: string[], files: string[]): ListPage => ({
  folders,
  objects: files.map((key) => ({ key, size: 10, lastModified: null })),
  nextToken: null,
});

const badKeys = { kind: "badCredentials", message: "The keys were rejected." };

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

beforeEach(() => {
  forgetRememberedFolders();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listConnections.mockResolvedValue([media]);
  api.listBuckets.mockResolvedValue(["archive"]);
  api.listObjects.mockResolvedValue(page([], []));
  api.setLastLocation.mockResolvedValue(undefined);
  api.onTransferState.mockResolvedValue(() => undefined);
  api.onTransferProgress.mockResolvedValue(() => undefined);
  api.listTransfers.mockResolvedValue([]);
  api.onFileDrop.mockResolvedValue(() => undefined);
  api.startUploads.mockResolvedValue(["t1"]);
  api.planCopy.mockResolvedValue({ files: 1, bytes: 10, existing: 0, examples: [] });
  api.startCopy.mockResolvedValue(["t2"]);
  api.getSettings.mockResolvedValue({ theme: "system" });
  api.setSettings.mockImplementation(async (settings: unknown) => settings);
  api.setWindowTheme.mockResolvedValue(undefined);
  api.getUsage.mockResolvedValue(null);
  api.onUsageProgress.mockResolvedValue(() => undefined);
  api.startUsageCount.mockResolvedValue(null);
  api.deleteObjects.mockResolvedValue(1);
  api.showContextMenu.mockResolvedValue(undefined);
});

describe("App", () => {
  it("welcomes a first-time user and links to the key guide", async () => {
    api.listConnections.mockResolvedValue([]);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Welcome to Kelp" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Where do I find my keys?" }));
    expect(api.openDocs).toHaveBeenCalledWith("/docs/");
    await userEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Add a connection" }));
    expect(screen.getByRole("dialog", { name: "Add a connection" })).toBeTruthy();
  });

  it("asks for new keys when listing buckets is rejected, and tries again", async () => {
    api.listBuckets.mockRejectedValueOnce(badKeys).mockRejectedValueOnce(badKeys);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "This connection's keys no longer work" })).toBeTruthy();
    expect(screen.getByText("They may have been changed or revoked at your provider.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.listBuckets).toHaveBeenCalledTimes(2));
    await userEvent.click(await screen.findByRole("button", { name: "Update keys" }));
    expect(screen.getByRole("dialog", { name: "Edit connection" })).toBeTruthy();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("media");
  });

  it("shows the error message when listing buckets fails for another reason", async () => {
    api.listBuckets.mockRejectedValueOnce({ kind: "network", message: "Kelp can't reach the provider. Check your connection." });
    render(<App />);
    const body = await screen.findAllByText("Kelp can't reach the provider. Check your connection.");
    expect(body.some((node) => node.closest("main"))).toBe(true);
    expect(screen.queryByText("Choose a bucket")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This folder is empty")).toBeTruthy();
  });

  it("asks for new keys when listing a folder is rejected", async () => {
    api.listObjects.mockRejectedValueOnce(badKeys);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "This connection's keys no longer work" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update keys" })).toBeTruthy();
  });

  it("shows the error message when listing a folder fails for another reason", async () => {
    api.listObjects.mockRejectedValueOnce({ kind: "provider", message: "The provider returned an error. Try again later." });
    render(<App />);
    expect(await screen.findByText("The provider returned an error. Try again later.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This folder is empty")).toBeTruthy();
  });

  it("opens folders with Enter but leaves files alone", async () => {
    api.listObjects.mockResolvedValue(page(["docs/"], ["a.txt"]));
    render(<App />);
    await screen.findByText("a.txt");
    const user = userEvent.setup();
    await user.click(screen.getByText("a.txt"));
    await user.keyboard("{Enter}");
    expect(api.listObjects).toHaveBeenCalledTimes(1);
    expect(api.startDownload).not.toHaveBeenCalled();
    await user.click(screen.getByText("docs"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.listObjects).toHaveBeenLastCalledWith("c1", "archive", "docs/", null));
  });

  it("returns to the folder the user left when switching connections back", async () => {
    const cdn: ConnectionProfile = { ...media, id: "c2", name: "cdn", settings: { ...media.settings, kind: "r2" } };
    api.listConnections.mockResolvedValue([media, cdn]);
    api.listObjects.mockResolvedValue(page(["docs/"], []));
    render(<App />);
    await screen.findByText("docs");
    const user = userEvent.setup();
    await user.click(screen.getByText("docs"));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(api.listObjects).toHaveBeenLastCalledWith("c1", "archive", "docs/", null));
    await user.click(screen.getByRole("button", { name: "Cloudflare · cdn" }));
    expect(api.setLastLocation).toHaveBeenCalledWith("c1", { bucket: "archive", prefix: "docs/" });
    expect(screen.queryByText("Hetzner · media")).toBeNull();
    await waitFor(() => expect(api.listObjects).toHaveBeenLastCalledWith("c2", "archive", "", null));
    await user.click(screen.getByRole("button", { name: "Hetzner · media" }));
    await waitFor(() => expect(api.listObjects).toHaveBeenLastCalledWith("c1", "archive", "docs/", null));
  });

  it("clears the selection and filter when going back", async () => {
    api.listObjects.mockResolvedValue(page(["docs/"], ["a.txt"]));
    render(<App />);
    await screen.findByText("docs");
    const user = userEvent.setup();
    await user.click(screen.getByText("docs"));
    await user.keyboard("{Enter}");
    await screen.findByText("a.txt");
    await user.type(screen.getByLabelText("Filter this folder"), "a");
    await user.click(screen.getByText("a.txt"));
    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("docs");
    expect((screen.getByLabelText("Filter this folder") as HTMLInputElement).value).toBe("");
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it("comes back to the same scroll position after opening a folder and going back", async () => {
    const many = Array.from({ length: 300 }, (_, i) => `file${String(i).padStart(3, "0")}.txt`);
    api.listObjects.mockImplementation(async (_id: string, _bucket: string, prefix: string) =>
      prefix === "" ? page(["docs/"], many) : page([], ["inside.txt"]),
    );
    HTMLElement.prototype.scrollTo = function (this: HTMLElement, options?: ScrollToOptions | number) {
      if (typeof options === "object" && options.top !== undefined) this.scrollTop = options.top;
    } as typeof HTMLElement.prototype.scrollTo;
    render(<App />);
    await screen.findByText("docs");
    const user = userEvent.setup();
    await user.click(screen.getByText("docs"));
    const grid = screen.getByRole("grid", { name: "Files" });
    grid.scrollTop = 2400;
    fireEvent.scroll(grid);
    await user.keyboard("{Enter}");
    await screen.findByText("inside.txt");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("grid", { name: "Files" }).scrollTop).toBe(2400));
    Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  });

  it("goes up exactly one folder on Backspace", async () => {
    api.listConnections.mockResolvedValue([{ ...media, lastLocation: { bucket: "archive", prefix: "a/b/" } }]);
    api.listObjects.mockResolvedValue(page([], ["x.txt"]));
    render(<App />);
    await screen.findByText("x.txt");
    const user = userEvent.setup();
    await user.click(screen.getByText("x.txt"));
    await user.keyboard("{Backspace}");
    await waitFor(() => expect(api.listObjects).toHaveBeenLastCalledWith("c1", "archive", "a/", null));
    await screen.findByText("x.txt");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(api.listObjects).toHaveBeenLastCalledWith("c1", "archive", "a/b/", null));
  });

  it("deletes only the selected rows the filter still shows", async () => {
    api.listObjects.mockResolvedValue(page([], ["a1.txt", "a2.txt", "b.txt"]));
    api.confirm.mockResolvedValue(true);
    render(<App />);
    await screen.findByText("b.txt");
    const user = userEvent.setup();
    await user.click(screen.getByText("a1.txt"));
    await user.keyboard("{Meta>}a{/Meta}");
    await user.type(screen.getByLabelText("Filter this folder"), "a");
    await waitFor(() => expect(screen.queryByText("b.txt")).toBeNull());
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("a1.txt") });
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const remove = entries.find((entry) => entry !== "separator" && entry.label.startsWith("Delete"));
    if (!remove || remove === "separator") throw new Error("no delete entry");
    expect(remove.label).toBe("Delete 2 items…");
    remove.onSelect();
    await waitFor(() => expect(api.deleteObjects).toHaveBeenCalledWith("c1", "archive", ["a1.txt", "a2.txt"]));
    expect(api.confirm.mock.calls[0][1]).toBe("Delete 2 items");
  });

  it("applies the saved theme and changes it from Settings", async () => {
    api.getSettings.mockResolvedValue({ theme: "light" });
    render(<App />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    const user = userEvent.setup();
    await user.keyboard("{Meta>},{/Meta}");
    await user.click(await screen.findByRole("radio", { name: "Dark" }));
    expect(api.setSettings).toHaveBeenCalledWith({ theme: "dark" });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    delete document.documentElement.dataset.theme;
  });

  it("opens a folder from the command palette", async () => {
    api.listObjects.mockImplementation(async (_id: string, _bucket: string, prefix: string) =>
      prefix === "" ? page(["drafts/"], ["a.txt"]) : page([], ["inside.txt"]),
    );
    render(<App />);
    await screen.findByText("a.txt");
    const user = userEvent.setup();
    await user.keyboard("{Meta>}k{/Meta}");
    await user.type(screen.getByRole("combobox", { name: "Search commands and places" }), "dra");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("inside.txt")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Search commands and places" })).toBeNull();
  });

  it("offers Download only with a selection, and ⌘D downloads it but not while typing", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.startDownload.mockResolvedValue("t1");
    render(<App />);
    await screen.findByText("a.txt");
    const user = userEvent.setup();
    await user.keyboard("{Meta>}k{/Meta}");
    expect(screen.queryByRole("option", { name: /Download/ })).toBeNull();
    await user.keyboard("{Escape}");
    await user.click(screen.getByText("a.txt"));
    await user.click(screen.getByLabelText("Filter this folder"));
    await user.keyboard("{Meta>}d{/Meta}");
    expect(api.startDownload).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText("Filter this folder"));
    await user.click(screen.getByText("a.txt"));
    await user.keyboard("{Meta>}d{/Meta}");
    await waitFor(() => expect(api.startDownload).toHaveBeenCalledWith("c1", "archive", "a.txt", 10));
  });

  it("previews the selected file with Space and steps to the next one", async () => {
    api.listObjects.mockResolvedValue(page(["docs/"], ["a.jpg", "b.jpg"]));
    render(<App />);
    await screen.findByText("a.jpg");
    const user = userEvent.setup();
    await user.click(screen.getByText("a.jpg"));
    await user.keyboard(" ");
    expect(await screen.findByRole("dialog", { name: "a.jpg" })).toBeTruthy();
    await user.keyboard("{ArrowRight}");
    expect(await screen.findByRole("dialog", { name: "b.jpg" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "b.jpg" })).toBeNull();
  });

  it("keeps previewing the same file when the folder reloads", async () => {
    api.listObjects.mockResolvedValue(page([], ["b.jpg", "c.jpg"]));
    let emit: (view: TransferView) => void = () => undefined;
    api.onTransferState.mockImplementation(async (handler: (view: TransferView) => void) => {
      emit = handler;
      return () => undefined;
    });
    render(<App />);
    await screen.findByText("b.jpg");
    const user = userEvent.setup();
    await user.click(screen.getByText("b.jpg"));
    await user.keyboard(" ");
    await screen.findByRole("dialog", { name: "b.jpg" });
    api.listObjects.mockResolvedValue(page([], ["a.jpg", "b.jpg", "c.jpg"]));
    const upload: TransferView = {
      id: "t9", direction: "upload", kind: "file", name: "a.jpg", destination: "archive/", status: "finished",
      retryAt: null, total: 1, done: 1, filesTotal: 1, filesDone: 1, filesFailed: 0, error: null, path: null, moving: false,
    };
    act(() => emit(upload));
    await waitFor(() => expect(api.listObjects).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(screen.getByRole("dialog", { name: "b.jpg" })).toBeTruthy();
  });

  it("keeps a tab's place when its own connection is clicked again", async () => {
    api.listObjects.mockResolvedValue(page(["docs/"], []));
    render(<App />);
    await screen.findByText("docs");
    const user = userEvent.setup();
    await user.dblClick(screen.getByText("docs"));
    await waitFor(() => expect(api.listObjects).toHaveBeenLastCalledWith("c1", "archive", "docs/", null));
    await user.click(document.body);
    await user.keyboard("{Meta>}t{/Meta}");
    await user.click(screen.getAllByRole("button", { name: "Hetzner · media" })[0]);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["archive / docs", "archive / docs"]);
  });

  it("opens tabs that keep their own filter", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt", "b.txt"]));
    render(<App />);
    await screen.findByText("b.txt");
    expect(screen.queryByRole("tablist")).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Filter this folder"), "a");
    await user.click(document.body);
    await user.keyboard("{Meta>}t{/Meta}");
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    const visibleFilter = () => screen.getAllByLabelText("Filter this folder").find((field) => field.closest("[hidden]") === null) as HTMLInputElement;
    await waitFor(() => expect(visibleFilter().value).toBe(""));
    await user.keyboard("{Meta>}{Shift>}[[{/Shift}{/Meta}");
    expect(visibleFilter().value).toBe("a");
    await user.keyboard("{Meta>}w{/Meta}");
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("moves a dragged file into a folder after asking, and copies at once with Option", async () => {
    api.listObjects.mockResolvedValue(page(["drafts/"], ["a.mp4"]));
    render(<App />);
    const row = await screen.findByText("a.mp4");
    const drafts = screen.getByText("drafts");
    document.elementFromPoint = vi.fn(() => drafts);
    const drop = async (altKey: boolean) => {
      fireEvent.pointerDown(row, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 40, buttons: 1 });
      fireEvent.pointerUp(window, { clientX: 40, clientY: 40, altKey });
    };
    const request = { from: "c1", fromBucket: "archive", keys: ["a.mp4"], to: "c1", toBucket: "archive", prefix: "drafts/" };
    await act(async () => drop(false));
    expect(await screen.findByRole("dialog", { name: "Move 1 item to drafts/?" })).toBeTruthy();
    expect(api.planCopy).toHaveBeenCalledWith(request);
    await userEvent.setup().click(screen.getByRole("button", { name: "Move 1 item" }));
    expect(api.startCopy).toHaveBeenCalledWith(request, false, true);
    await act(async () => drop(true));
    await waitFor(() => expect(api.startCopy).toHaveBeenLastCalledWith(request, false, false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("drags only the selected rows the filter still shows", async () => {
    api.listObjects.mockResolvedValue(page(["drafts/"], ["a.mp4", "b.mp4"]));
    render(<App />);
    await screen.findByText("b.mp4");
    const user = userEvent.setup();
    await user.click(screen.getByText("a.mp4"));
    await user.keyboard("{Meta>}");
    await user.click(screen.getByText("b.mp4"));
    await user.keyboard("{/Meta}");
    await user.type(screen.getByLabelText("Filter this folder"), "a.mp4");
    await waitFor(() => expect(screen.queryByText("b.mp4")).toBeNull());
    await user.clear(screen.getByLabelText("Filter this folder"));
    await user.type(screen.getByLabelText("Filter this folder"), "a");
    const row = screen.getByText("a.mp4");
    document.elementFromPoint = vi.fn(() => screen.getByText("drafts"));
    await act(async () => {
      fireEvent.pointerDown(row, { button: 0, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 40, buttons: 1 });
      fireEvent.pointerUp(window, { clientX: 40, clientY: 40, altKey: true });
    });
    await waitFor(() => expect(api.planCopy).toHaveBeenCalled());
    expect(api.planCopy.mock.calls[0][0].keys).toEqual(["a.mp4"]);
  });

  it("previews from the row button and the right-click menu", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.jpg"]));
    render(<App />);
    await screen.findByText("a.jpg");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Preview a.jpg" }));
    expect(await screen.findByRole("dialog", { name: "a.jpg" })).toBeTruthy();
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("a.jpg") });
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const preview = entries.find((entry) => entry !== "separator" && entry.label === "Preview");
    if (!preview || preview === "separator") throw new Error("no preview entry");
    act(() => preview.onSelect());
    expect(await screen.findByRole("dialog", { name: "a.jpg" })).toBeTruthy();
  });

  it("refreshes the folder from the toolbar and with ⌘R", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.jpg"]));
    render(<App />);
    await screen.findByText("a.jpg");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.listObjects).toHaveBeenCalledTimes(2));
    await user.click(document.body);
    await user.keyboard("{Meta>}r{/Meta}");
    await waitFor(() => expect(api.listObjects).toHaveBeenCalledTimes(3));
  });

  it("shows connection errors from the backend", async () => {
    api.listConnections.mockRejectedValue({ kind: "io", message: "Kelp couldn't read or write a file on this Mac: connections.json is damaged" });
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Kelp couldn't load your connections" })).toBeTruthy();
    expect(screen.getByText(/connections.json is damaged/)).toBeTruthy();
  });

  it("keeps transfers and errors reachable when no folder is open", async () => {
    const cdn: ConnectionProfile = { ...media, id: "c2", name: "cdn", settings: { ...media.settings, kind: "r2" } };
    api.listConnections.mockResolvedValue([media, cdn]);
    api.listBuckets.mockImplementation(async (id: string) => (id === "c1" ? ["archive"] : ["a", "b"]));
    api.deleteConnection.mockRejectedValue({ kind: "io", message: "The connection list couldn't be saved." });
    api.confirm.mockResolvedValue(true);
    let emit: (view: TransferView) => void = () => undefined;
    api.onTransferState.mockImplementation(async (handler: (view: TransferView) => void) => {
      emit = handler;
      return () => undefined;
    });
    render(<App />);
    await screen.findByText("This folder is empty");
    const running: TransferView = {
      id: "t1", direction: "download", kind: "file", name: "a.txt", destination: "/Users/me/Downloads/a.txt", status: "running",
      retryAt: null, total: 10, done: 0, filesTotal: 1, filesDone: 0, filesFailed: 0, error: null, path: null, moving: false,
    };
    act(() => emit(running));
    act(() => emit({ ...running, status: "finished", done: 10, filesDone: 1, path: running.destination }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Cloudflare · cdn" }));
    expect(await screen.findByText("Choose a bucket")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "1 finished" }));
    await user.click(screen.getByRole("button", { name: /^Finished/ }));
    expect(screen.getByRole("button", { name: "Show a.txt in Finder" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close transfers" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "1 finished" }));
    await user.pointer({ keys: "[MouseRight]", target: screen.getByRole("button", { name: "Cloudflare · cdn" }) });
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const remove = entries.find((entry) => entry !== "separator" && entry.label.startsWith("Delete"));
    if (!remove || remove === "separator") throw new Error("no delete entry");
    remove.onSelect();
    expect((await screen.findByRole("alert")).textContent).toContain("The connection list couldn't be saved.");
  });

  it("uploads a folder after asking once about files already there", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.pickFolder.mockResolvedValue("/Users/me/photos");
    api.planUpload.mockResolvedValue({ files: 10, bytes: 100, existing: 2, examples: ["photos/a.jpg", "photos/b.jpg"] });
    render(<App />);
    await screen.findByText("a.txt");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Upload" }));
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    expect(entries.map((entry) => (entry === "separator" ? entry : entry.label))).toEqual(["Upload files…", "Upload a folder…"]);
    const folder = entries[1];
    if (folder === "separator") throw new Error("no folder entry");
    folder.onSelect();
    await user.click(await screen.findByRole("button", { name: "Skip 2 existing" }));
    expect(api.planUpload).toHaveBeenCalledWith("c1", "archive", "", ["/Users/me/photos"]);
    expect(api.startUploads).toHaveBeenCalledWith("c1", "archive", "", ["/Users/me/photos"], true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uploads a folder straight away when nothing clashes", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.pickFolder.mockResolvedValue("/Users/me/photos");
    api.planUpload.mockResolvedValue({ files: 10, bytes: 100, existing: 0, examples: [] });
    render(<App />);
    await screen.findByText("a.txt");
    await userEvent.setup().click(screen.getByRole("button", { name: "Upload" }));
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const folder = entries[1];
    if (folder === "separator") throw new Error("no folder entry");
    folder.onSelect();
    await waitFor(() => expect(api.startUploads).toHaveBeenCalledWith("c1", "archive", "", ["/Users/me/photos"], false));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uploads what is dropped onto a folder row into that folder", async () => {
    api.listObjects.mockResolvedValue(page(["drafts/"], ["a.txt"]));
    api.inspectDrop.mockResolvedValue({ files: 1, folders: 0, bytes: 5, loose: 1 });
    api.planUpload.mockResolvedValue({ files: 1, bytes: 5, existing: 0, examples: [] });
    let emit: (event: FileDropEvent) => void = () => undefined;
    api.onFileDrop.mockImplementation(async (handler: (event: FileDropEvent) => void) => {
      emit = handler;
      return () => undefined;
    });
    render(<App />);
    await screen.findByText("a.txt");
    document.elementFromPoint = vi.fn(() => screen.getByText("drafts"));
    act(() => emit({ type: "enter", paths: ["/u/a.txt"], x: 10, y: 10 }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Upload 1 file · 5 B to drafts/"));
    act(() => emit({ type: "drop", paths: ["/u/a.txt"], x: 10, y: 10 }));
    await waitFor(() => expect(api.startUploads).toHaveBeenCalledWith("c1", "archive", "drafts/", ["/u/a.txt"], false));
    expect(api.planUpload).toHaveBeenCalledWith("c1", "archive", "drafts/", ["/u/a.txt"]);
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(""));
  });

  it("aims a drop at the point the pointer is at, even on a Retina screen", async () => {
    api.listObjects.mockResolvedValue(page(["drafts/"], ["a.txt"]));
    api.inspectDrop.mockResolvedValue({ files: 1, folders: 0, bytes: 5, loose: 1 });
    let emit: (event: FileDropEvent) => void = () => undefined;
    api.onFileDrop.mockImplementation(async (handler: (event: FileDropEvent) => void) => {
      emit = handler;
      return () => undefined;
    });
    const ratio = window.devicePixelRatio;
    window.devicePixelRatio = 2;
    render(<App />);
    await screen.findByText("a.txt");
    const pick = vi.fn(() => screen.getByText("drafts"));
    document.elementFromPoint = pick;
    act(() => emit({ type: "enter", paths: ["/u/a.txt"], x: 900, y: 500 }));
    window.devicePixelRatio = ratio;
    expect(pick).toHaveBeenCalledWith(900, 500);
  });

  it("says it is checking between a drop and the upload, and announces it", async () => {
    api.listObjects.mockResolvedValue(page(["drafts/"], ["a.txt"]));
    let answer: (plan: { files: number; bytes: number; existing: number; examples: string[] }) => void = () => undefined;
    api.planUpload.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    let emit: (event: FileDropEvent) => void = () => undefined;
    api.onFileDrop.mockImplementation(async (handler: (event: FileDropEvent) => void) => {
      emit = handler;
      return () => undefined;
    });
    const { container } = render(<App />);
    await screen.findByText("a.txt");
    expect(screen.getByRole("status").className).toContain("visually-hidden");
    expect(screen.getByRole("status").textContent).toBe("");
    document.elementFromPoint = vi.fn(() => screen.getByText("drafts"));
    act(() => emit({ type: "drop", paths: ["/u/a.txt"], x: 1, y: 1 }));
    expect(await screen.findByText("Checking what's already in drafts/…", { selector: ".drop-pill" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Checking what's already in drafts/…");
    expect(container.querySelector(".drop-pill")?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => answer({ files: 1, bytes: 1, existing: 0, examples: [] }));
    await waitFor(() => expect(container.querySelector(".drop-pill")).toBeNull());
  });

  it("says so when a drop has nothing to upload", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.planUpload.mockResolvedValue({ files: 0, bytes: 0, existing: 0, examples: [] });
    api.startUploads.mockResolvedValue([]);
    let emit: (event: FileDropEvent) => void = () => undefined;
    api.onFileDrop.mockImplementation(async (handler: (event: FileDropEvent) => void) => {
      emit = handler;
      return () => undefined;
    });
    render(<App />);
    const row = await screen.findByText("a.txt");
    document.elementFromPoint = vi.fn(() => row);
    act(() => emit({ type: "drop", paths: ["/u/empty"], x: 1, y: 1 }));
    expect((await screen.findByRole("alert")).textContent).toContain("Nothing to upload. The folder is empty or everything is already there.");
    expect(screen.queryByRole("region", { name: "Transfers" })).toBeNull();
  });

  it("ignores a second drop while the first one is still being checked", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.planUpload.mockReturnValue(new Promise(() => undefined));
    let emit: (event: FileDropEvent) => void = () => undefined;
    api.onFileDrop.mockImplementation(async (handler: (event: FileDropEvent) => void) => {
      emit = handler;
      return () => undefined;
    });
    render(<App />);
    const row = await screen.findByText("a.txt");
    document.elementFromPoint = vi.fn(() => row);
    act(() => emit({ type: "drop", paths: ["/u/slow"], x: 1, y: 1 }));
    await screen.findByText("Checking what's already in archive…", { selector: ".drop-pill" });
    act(() => emit({ type: "drop", paths: ["/u/other.txt"], x: 1, y: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.planUpload).toHaveBeenCalledTimes(1);
  });

  it("ignores a second drop while the first one is still asking", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.planUpload.mockResolvedValue({ files: 1, bytes: 1, existing: 1, examples: ["a.txt"] });
    let emit: (event: FileDropEvent) => void = () => undefined;
    api.onFileDrop.mockImplementation(async (handler: (event: FileDropEvent) => void) => {
      emit = handler;
      return () => undefined;
    });
    render(<App />);
    const row = await screen.findByText("a.txt");
    document.elementFromPoint = vi.fn(() => row);
    act(() => emit({ type: "drop", paths: ["/u/a.txt"], x: 1, y: 1 }));
    await screen.findByRole("dialog");
    act(() => emit({ type: "drop", paths: ["/u/other.txt"], x: 1, y: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.planUpload).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Uploading "a.txt" to archive/ would replace them.')).toBeTruthy();
  });

  it("asks once when a drop would replace files", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.inspectDrop.mockResolvedValue({ files: 5, folders: 0, bytes: 5, loose: 5 });
    api.planUpload.mockResolvedValue({ files: 5, bytes: 5, existing: 2, examples: ["a.txt", "b.txt"] });
    let emit: (event: FileDropEvent) => void = () => undefined;
    api.onFileDrop.mockImplementation(async (handler: (event: FileDropEvent) => void) => {
      emit = handler;
      return () => undefined;
    });
    render(<App />);
    await screen.findByText("a.txt");
    document.elementFromPoint = vi.fn(() => screen.getByText("a.txt"));
    act(() => emit({ type: "drop", paths: ["/u/a.txt", "/u/b.txt"], x: 1, y: 1 }));
    expect(await screen.findByRole("dialog", { name: "2 of 5 files are already here" })).toBeTruthy();
    expect(screen.getByText("Uploading 2 items to archive/ would replace them.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Skip 2 existing" }));
    expect(api.startUploads).toHaveBeenCalledWith("c1", "archive", "", ["/u/a.txt", "/u/b.txt"], true);
  });

  it("asks once when picked files already exist", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.pickFiles.mockResolvedValue(["/u/a.txt", "/u/b.txt"]);
    api.planUpload.mockResolvedValue({ files: 2, bytes: 2, existing: 2, examples: ["a.txt", "b.txt"] });
    render(<App />);
    await screen.findByText("a.txt");
    await userEvent.setup().click(screen.getByRole("button", { name: "Upload" }));
    const files = (api.showContextMenu.mock.calls[0][0] as MenuEntry[])[0];
    if (files === "separator") throw new Error("no files entry");
    files.onSelect();
    expect(await screen.findByRole("dialog", { name: "2 of 2 files are already here" })).toBeTruthy();
    expect(api.confirm).not.toHaveBeenCalled();
  });

  it("downloads folders as well as files from the menu", async () => {
    api.listObjects.mockResolvedValue(page(["docs/"], ["a.txt"]));
    api.startDownload.mockResolvedValue("t1");
    api.startFolderDownload.mockResolvedValue("t2");
    render(<App />);
    await screen.findByText("a.txt");
    const user = userEvent.setup();
    await user.click(screen.getByText("a.txt"));
    await user.keyboard("{Meta>}a{/Meta}");
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("a.txt") });
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const download = entries.find((entry) => entry !== "separator" && entry.label.startsWith("Download"));
    if (!download || download === "separator") throw new Error("no download entry");
    expect(download.label).toBe("Download 2 items");
    download.onSelect();
    await waitFor(() => expect(api.startFolderDownload).toHaveBeenCalledWith("c1", "archive", "docs/"));
    expect(api.startDownload).toHaveBeenCalledWith("c1", "archive", "a.txt", 10);
  });

  it("calculates the size of the open folder, a folder row or a bucket", async () => {
    api.listObjects.mockResolvedValue(page(["docs/"], ["a.txt"]));
    render(<App />);
    await screen.findByText("a.txt");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Calculate size" }));
    expect(api.startUsageCount).toHaveBeenCalledWith("c1", "archive", "");
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("docs") });
    const rowEntries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const folderSize = rowEntries.find((entry) => entry !== "separator" && entry.label === "Calculate size");
    if (!folderSize || folderSize === "separator") throw new Error("no size entry for the folder");
    folderSize.onSelect();
    await waitFor(() => expect(api.startUsageCount).toHaveBeenCalledWith("c1", "archive", "docs/"));
    const bucketColumn = screen.getByRole("complementary", { name: "Buckets" });
    await user.pointer({ keys: "[MouseRight]", target: within(bucketColumn).getByRole("button", { name: "archive" }) });
    const bucketEntries = api.showContextMenu.mock.calls[1][0] as MenuEntry[];
    expect(bucketEntries.map((entry) => (entry === "separator" ? entry : entry.label))).toEqual(["Calculate size"]);
  });

  it("reloads the folder even when a delete partly fails", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.confirm.mockResolvedValue(true);
    api.deleteObjects.mockRejectedValue({ kind: "provider", message: "Some files couldn't be deleted." });
    render(<App />);
    await screen.findByText("a.txt");
    const user = userEvent.setup();
    await user.pointer({ keys: "[MouseRight]", target: screen.getByText("a.txt") });
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const remove = entries.find((entry) => entry !== "separator" && entry.label.startsWith("Delete"));
    if (!remove || remove === "separator") throw new Error("no delete entry");
    remove.onSelect();
    expect((await screen.findByRole("alert")).textContent).toContain("Some files couldn't be deleted.");
    await waitFor(() => expect(api.listObjects).toHaveBeenCalledTimes(2));
  });

  it("replays the row intro for each folder it opens", async () => {
    api.listObjects.mockImplementation(async (_id: string, _bucket: string, prefix: string) =>
      prefix === "" ? page(["docs/"], []) : page([], ["a.txt"]),
    );
    render(<App />);
    await screen.findByText("docs");
    const user = userEvent.setup();
    await user.click(screen.getByText("docs"));
    await user.keyboard("{Enter}");
    const row = (await screen.findByText("a.txt")).closest(".file-row");
    expect(row?.classList.contains("intro")).toBe(true);
  });
});
