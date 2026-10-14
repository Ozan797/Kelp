import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

export type ProviderKind = "s3" | "r2" | "hetzner";

export type ConnectionSettings = {
  kind: ProviderKind;
  endpoint: string | null;
  region: string;
  pathStyle: boolean;
  accessKeyId: string;
};

export type Location = { bucket: string; prefix: string };

export type ConnectionProfile = {
  id: string;
  name: string;
  settings: ConnectionSettings;
  bucket: string | null;
  lastLocation: Location | null;
};

export type ConnectionDraft = {
  id: string | null;
  name: string;
  settings: ConnectionSettings;
  bucket: string | null;
  secret: string | null;
};

export type CheckResult = { buckets: string[]; limitedToBucket: boolean };
export type ObjectMeta = { key: string; size: number; lastModified: string | null };
export type ListPage = { folders: string[]; objects: ObjectMeta[]; nextToken: string | null };

export type ErrorKind =
  | "invalidSettings"
  | "accessDenied"
  | "bucketNotFound"
  | "badCredentials"
  | "clockWrong"
  | "network"
  | "provider"
  | "notListable"
  | "keychain"
  | "io"
  | "fileTooLarge"
  | "connectionNotFound"
  | "alreadyExists";

export type AppError = { kind: ErrorKind; message: string };

export type Direction = "upload" | "download";
export type TransferStatus = "running" | "finished" | "failed" | "cancelled";
export type TransferInfo = { id: string; direction: Direction; name: string; destination: string; total: number };
export type TransferProgress = { id: string; done: number; total: number };
export type TransferStateEvent = {
  id: string;
  state: TransferStatus;
  info: TransferInfo | null;
  error: AppError | null;
  path: string | null;
};

export type MenuEntry = { label: string; onSelect: () => void } | "separator";

export function toAppError(value: unknown): AppError {
  if (typeof value === "object" && value !== null && "kind" in value && "message" in value) {
    return value as AppError;
  }
  return { kind: "provider", message: String(value) };
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toAppError(error);
  }
}

export const api = {
  listConnections: () => call<ConnectionProfile[]>("list_connections"),
  testConnection: (draft: ConnectionDraft) => call<CheckResult>("test_connection", { draft }),
  saveConnection: (draft: ConnectionDraft) => call<ConnectionProfile>("save_connection", { draft }),
  deleteConnection: (id: string) => call<void>("delete_connection", { id }),
  setLastLocation: (id: string, location: Location | null) =>
    call<void>("set_last_location", { id, location }),
  listBuckets: (id: string) => call<string[]>("list_buckets", { id }),
  listObjects: (id: string, bucket: string, prefix: string, token: string | null) =>
    call<ListPage>("list_objects", { id, bucket, prefix, token }),
  createFolder: (id: string, bucket: string, prefix: string, name: string) =>
    call<string>("create_folder", { id, bucket, prefix, name }),
  deleteObjects: (id: string, bucket: string, keys: string[]) =>
    call<number>("delete_objects", { id, bucket, keys }),
  startUpload: (id: string, bucket: string, prefix: string, path: string, replace: boolean) =>
    call<string>("start_upload", { id, bucket, prefix, path, replace }),
  startDownload: (id: string, bucket: string, key: string, size: number) =>
    call<string>("start_download", { id, bucket, key, size }),
  cancelTransfer: (transfer: string) => call<void>("cancel_transfer", { transfer }),
  onTransferProgress: (handler: (event: TransferProgress) => void): Promise<UnlistenFn> =>
    listen<TransferProgress>("transfer://progress", (event) => handler(event.payload)),
  onTransferState: (handler: (event: TransferStateEvent) => void): Promise<UnlistenFn> =>
    listen<TransferStateEvent>("transfer://state", (event) => handler(event.payload)),
  pickFiles: async (): Promise<string[]> => {
    const picked = await open({ multiple: true, directory: false });
    if (picked === null) return [];
    return Array.isArray(picked) ? picked : [picked];
  },
  confirm: (message: string, okLabel: string) =>
    ask(message, { title: "Kelp", kind: "warning", okLabel, cancelLabel: "Cancel" }),
  revealInFinder: (path: string) => revealItemInDir(path),
  openDocs: (path: string) => openUrl(`https://kelp.ozanai.dev${path}`),
  showContextMenu: async (entries: MenuEntry[]) => {
    const items = await Promise.all(
      entries.map((entry) =>
        entry === "separator"
          ? PredefinedMenuItem.new({ item: "Separator" })
          : MenuItem.new({ text: entry.label, action: entry.onSelect }),
      ),
    );
    const menu = await Menu.new({ items });
    await menu.popup();
  },
};
