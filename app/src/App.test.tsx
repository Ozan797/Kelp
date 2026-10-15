import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile, ListPage, MenuEntry, TransferView } from "./lib/tauri";
import App from "./App";

const api = vi.hoisted(() => ({
  listConnections: vi.fn(),
  listBuckets: vi.fn(),
  listObjects: vi.fn(),
  setLastLocation: vi.fn(),
  onTransferState: vi.fn(),
  onTransferProgress: vi.fn(),
  listTransfers: vi.fn(),
  confirm: vi.fn(),
  deleteObjects: vi.fn(),
  showContextMenu: vi.fn(),
  startDownload: vi.fn(),
  startFolderDownload: vi.fn(),
  pickFolder: vi.fn(),
  planFolderUpload: vi.fn(),
  startFolderUpload: vi.fn(),
  openDocs: vi.fn(),
  testConnection: vi.fn(),
  saveConnection: vi.fn(),
  deleteConnection: vi.fn(),
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
  Object.values(api).forEach((fn) => fn.mockReset());
  api.listConnections.mockResolvedValue([media]);
  api.listBuckets.mockResolvedValue(["archive"]);
  api.listObjects.mockResolvedValue(page([], []));
  api.setLastLocation.mockResolvedValue(undefined);
  api.onTransferState.mockResolvedValue(() => undefined);
  api.onTransferProgress.mockResolvedValue(() => undefined);
  api.listTransfers.mockResolvedValue([]);
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
      retryAt: null, total: 10, done: 0, filesTotal: 1, filesDone: 0, filesFailed: 0, error: null, path: null,
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
    api.planFolderUpload.mockResolvedValue({ files: 10, bytes: 100, existing: 2, examples: ["photos/a.jpg", "photos/b.jpg"] });
    api.startFolderUpload.mockResolvedValue("t1");
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
    expect(api.planFolderUpload).toHaveBeenCalledWith("c1", "archive", "", "/Users/me/photos");
    expect(api.startFolderUpload).toHaveBeenCalledWith("c1", "archive", "", "/Users/me/photos", true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("uploads a folder straight away when nothing clashes", async () => {
    api.listObjects.mockResolvedValue(page([], ["a.txt"]));
    api.pickFolder.mockResolvedValue("/Users/me/photos");
    api.planFolderUpload.mockResolvedValue({ files: 10, bytes: 100, existing: 0, examples: [] });
    api.startFolderUpload.mockResolvedValue("t1");
    render(<App />);
    await screen.findByText("a.txt");
    await userEvent.setup().click(screen.getByRole("button", { name: "Upload" }));
    const entries = api.showContextMenu.mock.calls[0][0] as MenuEntry[];
    const folder = entries[1];
    if (folder === "separator") throw new Error("no folder entry");
    folder.onSelect();
    await waitFor(() => expect(api.startFolderUpload).toHaveBeenCalledWith("c1", "archive", "", "/Users/me/photos", false));
    expect(screen.queryByRole("dialog")).toBeNull();
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
