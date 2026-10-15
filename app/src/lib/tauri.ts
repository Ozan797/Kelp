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
  | "alreadyExists"
  | "busy"
  | "objectChanged"
  | "uploadGone";

export type AppError = { kind: ErrorKind; message: string };

export type Direction = "upload" | "download";
export type TransferKind = "file" | "folder";
export type TransferStatus = "waiting" | "running" | "retrying" | "paused" | "failed" | "finished" | "cancelled";
export type TransferView = {
  id: string;
  direction: Direction;
  kind: TransferKind;
  name: string;
  destination: string;
  status: TransferStatus;
  retryAt: number | null;
  total: number;
  done: number;
  filesTotal: number;
  filesDone: number;
  filesFailed: number;
  error: string | null;
  path: string | null;
};
export type TransferProgress = { id: string; done: number; total: number; filesDone: number };

export type UsageView = {
  connectionId: string;
  bucket: string;
  prefix: string;
  bytes: number;
  objects: number;
  countedAtMs: number;
  complete: boolean;
  resumeToken: string | null;
  counting: boolean;
};

export type FolderPlan = { files: number; bytes: number; existing: number; examples: string[] };

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
  planFolderUpload: (id: string, bucket: string, prefix: string, path: string) =>
    call<FolderPlan>("plan_folder_upload", { id, bucket, prefix, path }),
  startFolderUpload: (id: string, bucket: string, prefix: string, path: string, skipExisting: boolean) =>
    call<string>("start_folder_upload", { id, bucket, prefix, path, skipExisting }),
  startFolderDownload: (id: string, bucket: string, prefix: string) =>
    call<string>("start_folder_download", { id, bucket, prefix }),
  getUsage: (id: string, bucket: string, prefix: string) => call<UsageView | null>("get_usage", { id, bucket, prefix }),
  startUsageCount: (id: string, bucket: string, prefix: string) =>
    call<UsageView | null>("start_usage_count", { id, bucket, prefix }),
  cancelUsageCount: (id: string, bucket: string, prefix: string) =>
    call<UsageView | null>("cancel_usage_count", { id, bucket, prefix }),
  onUsageProgress: (handler: (view: UsageView) => void): Promise<UnlistenFn> =>
    listen<UsageView>("usage://progress", (event) => handler(event.payload)),
  listTransfers: () => call<TransferView[]>("list_transfers"),
  pauseTransfer: (transfer: string) => call<void>("pause_transfer", { transfer }),
  resumeTransfer: (transfer: string) => call<void>("resume_transfer", { transfer }),
  retryTransfer: (transfer: string) => call<void>("retry_transfer", { transfer }),
  cancelTransfer: (transfer: string) => call<void>("cancel_transfer", { transfer }),
  pauseAll: () => call<void>("pause_all"),
  resumeAll: () => call<void>("resume_all"),
  onTransferProgress: (handler: (event: TransferProgress) => void): Promise<UnlistenFn> =>
    listen<TransferProgress>("transfer://progress", (event) => handler(event.payload)),
  onTransferState: (handler: (view: TransferView) => void): Promise<UnlistenFn> =>
    listen<TransferView>("transfer://state", (event) => handler(event.payload)),
  pickFiles: async (): Promise<string[]> => {
    const picked = await open({ multiple: true, directory: false });
    if (picked === null) return [];
    return Array.isArray(picked) ? picked : [picked];
  },
  pickFolder: async (): Promise<string | null> => {
    const picked = await open({ multiple: false, directory: true });
    return typeof picked === "string" ? picked : null;
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
