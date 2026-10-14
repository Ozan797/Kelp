import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionProfile } from "../lib/tauri";
import { ConnectionSheet, draftFromForm, formFromProfile } from "./ConnectionSheet";

const api = vi.hoisted(() => ({
  testConnection: vi.fn(),
  saveConnection: vi.fn(),
  openDocs: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  api,
  toAppError: (value: unknown) => value,
}));

beforeEach(() => {
  api.testConnection.mockReset();
  api.saveConnection.mockReset();
});

async function fillHetzner() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Name"), "media");
  await user.type(screen.getByLabelText("Endpoint URL"), "https://hel1.your-objectstorage.com");
  await user.type(screen.getByLabelText("Access key"), "AKID");
  await user.type(screen.getByLabelText("Secret key"), "s3cret");
  return user;
}

describe("draftFromForm", () => {
  it("builds the R2 endpoint from the account ID", () => {
    const form = { ...formFromProfile(null), kind: "r2" as const, name: "cdn", accountId: " abc123 ", accessKeyId: "K", secret: "S" };
    const draft = draftFromForm(form, null);
    expect(draft.settings.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
    expect(draft.settings.region).toBe("auto");
  });

  it("sends no secret when editing with the field left empty", () => {
    const profile: ConnectionProfile = {
      id: "c1",
      name: "media",
      settings: { kind: "hetzner", endpoint: null, region: "hel1", pathStyle: false, accessKeyId: "AKID" },
      bucket: null,
      lastLocation: null,
    };
    const draft = draftFromForm(formFromProfile(profile), "c1");
    expect(draft.secret).toBeNull();
    expect(draft.id).toBe("c1");
    expect(draft.settings.region).toBe("https://hel1.your-objectstorage.com");
  });

  it("never sends an endpoint override for Hetzner", () => {
    const form = { ...formFromProfile(null), hetznerEndpoint: "hel1", endpoint: "https://stale.example.com" };
    expect(draftFromForm(form, null).settings.endpoint).toBeNull();
  });

  it("reads the account ID back out of a saved R2 endpoint", () => {
    const profile: ConnectionProfile = {
      id: "c2",
      name: "cdn",
      settings: { kind: "r2", endpoint: "https://abc123.r2.cloudflarestorage.com", region: "auto", pathStyle: false, accessKeyId: "K" },
      bucket: null,
      lastLocation: null,
    };
    const form = formFromProfile(profile);
    expect(form.accountId).toBe("abc123");
    expect(form.endpoint).toBe("");
  });
});

describe("ConnectionSheet", () => {
  it("changes fields with the provider", async () => {
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Endpoint URL")).toHaveProperty("placeholder", "https://fsn1.your-objectstorage.com");
    await userEvent.click(screen.getByRole("radio", { name: "Cloudflare R2" }));
    expect(screen.queryByLabelText("Endpoint URL")).toBeNull();
    expect(screen.getByLabelText("Account ID")).toBeTruthy();
  });

  it("saves a Hetzner connection and reports it", async () => {
    const saved = { id: "new" };
    api.saveConnection.mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<ConnectionSheet initial={null} onSaved={onSaved} onCancel={vi.fn()} />);
    const user = await fillHetzner();
    await user.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
    const draft = api.saveConnection.mock.calls[0][0];
    expect(draft).toMatchObject({ name: "media", secret: "s3cret", bucket: null });
    expect(draft.settings).toMatchObject({ kind: "hetzner", region: "https://hel1.your-objectstorage.com", endpoint: null, accessKeyId: "AKID" });
  });

  it("shows wrong keys next to the key fields and saves nothing", async () => {
    api.saveConnection.mockRejectedValue({ kind: "badCredentials", message: "The secret key doesn't match the access key ID." });
    const onSaved = vi.fn();
    render(<ConnectionSheet initial={null} onSaved={onSaved} onCancel={vi.fn()} />);
    const user = await fillHetzner();
    await user.click(screen.getByRole("button", { name: "Save connection" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("doesn't match");
    expect(alert.closest(".field-group.keys")).not.toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("asks for a bucket when the key can't list buckets, then sends it", async () => {
    api.testConnection.mockRejectedValueOnce({ kind: "notListable", message: "This key can't list buckets. Enter the bucket you want to open." });
    api.testConnection.mockResolvedValueOnce({ buckets: ["media-archive"], limitedToBucket: true });
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = await fillHetzner();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    const bucket = await screen.findByLabelText("Bucket name");
    await user.type(bucket, "media-archive");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected. This key can open media-archive.")).toBeTruthy();
    expect(api.testConnection.mock.calls[1][0].bucket).toBe("media-archive");
  });

  it("shows a bad endpoint under the endpoint URL field and saves nothing", async () => {
    api.saveConnection.mockRejectedValue({
      kind: "invalidSettings",
      message: "Paste the endpoint URL from the Hetzner Console, such as https://fsn1.your-objectstorage.com.",
    });
    const onSaved = vi.fn();
    const onCancel = vi.fn();
    render(<ConnectionSheet initial={null} onSaved={onSaved} onCancel={onCancel} />);
    const user = await fillHetzner();
    await user.click(screen.getByRole("button", { name: "Save connection" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Paste the endpoint URL");
    expect(alert.closest(".field-group.keys")).toBeNull();
    expect(alert.closest(".fields")?.contains(screen.getByLabelText("Endpoint URL"))).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("shows network errors at the bottom", async () => {
    api.testConnection.mockRejectedValue({ kind: "network", message: "Couldn't reach the server. Check your connection and try again." });
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = await fillHetzner();
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    const alert = await screen.findByRole("alert");
    expect(alert.closest(".sheet-status")).not.toBeNull();
  });

  it("focuses the first field and labels the dialog", () => {
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    expect(screen.getByRole("dialog", { name: "Add a connection" })).toBeTruthy();
  });

  it("drops the endpoint override when the provider changes", async () => {
    api.testConnection.mockResolvedValue({ buckets: [], limitedToBucket: false });
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "AWS S3" }));
    await user.type(screen.getByLabelText("Name"), "media");
    await user.type(screen.getByLabelText("Access key"), "AKID");
    await user.type(screen.getByLabelText("Secret key"), "s3cret");
    await user.click(screen.getByRole("button", { name: "Advanced settings" }));
    await user.type(screen.getByLabelText("Endpoint"), "https://stale.example.com");
    await user.click(screen.getByRole("radio", { name: "Cloudflare R2" }));
    await user.type(screen.getByLabelText("Account ID"), "abc123");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(api.testConnection).toHaveBeenCalled());
    expect(api.testConnection.mock.calls[0][0].settings.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
  });

  it("fills the endpoint URL when editing a saved Hetzner connection", () => {
    const profile: ConnectionProfile = {
      id: "c1",
      name: "media",
      settings: { kind: "hetzner", endpoint: null, region: "hel1", pathStyle: false, accessKeyId: "AKID" },
      bucket: null,
      lastLocation: null,
    };
    render(<ConnectionSheet initial={profile} onSaved={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Endpoint URL")).toHaveProperty("value", "https://hel1.your-objectstorage.com");
  });

  it("offers the endpoint override for R2 and S3 but not Hetzner", async () => {
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Advanced settings" }));
    expect(screen.queryByLabelText("Endpoint")).toBeNull();
    expect(screen.getByLabelText("Path-style addressing")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Cloudflare R2" }));
    expect(screen.getByLabelText("Endpoint")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "AWS S3" }));
    expect(screen.getByLabelText("Endpoint")).toBeTruthy();
  });

  it("keeps Tab inside the sheet", async () => {
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = userEvent.setup();
    screen.getByRole("button", { name: "Save connection" }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Hetzner" }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save connection" }));
  });

  it("wraps Shift+Tab to the last control when R2 is selected", async () => {
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "Cloudflare R2" }));
    screen.getByRole("radio", { name: "Cloudflare R2" }).focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Save connection" }));
  });

  it("ignores Escape and disables Cancel while saving", async () => {
    api.saveConnection.mockReturnValue(new Promise(() => {}));
    const onCancel = vi.fn();
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={onCancel} />);
    const user = await fillHetzner();
    await user.click(screen.getByRole("button", { name: "Save connection" }));
    screen.getByLabelText("Name").focus();
    await user.keyboard("{Escape}");
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
  });

  it("closes on Escape from a button", async () => {
    const onCancel = vi.fn();
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={onCancel} />);
    screen.getByRole("button", { name: "Test connection" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });

  it("closes on Escape", async () => {
    const onCancel = vi.fn();
    render(<ConnectionSheet initial={null} onSaved={vi.fn()} onCancel={onCancel} />);
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalled();
  });
});
