import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  api,
  toAppError,
  type AppError,
  type CheckResult,
  type ConnectionDraft,
  type ConnectionProfile,
  type ProviderKind,
} from "../lib/tauri";
import { BrandLogo } from "./BrandLogo";

export type ConnectionForm = {
  kind: ProviderKind;
  name: string;
  hetznerEndpoint: string;
  accountId: string;
  region: string;
  accessKeyId: string;
  secret: string;
  bucket: string;
  endpoint: string;
  pathStyle: boolean;
};

const PROVIDERS: { kind: ProviderKind; label: string; guide: string; hint: string }[] = [
  { kind: "hetzner", label: "Hetzner", guide: "/docs/hetzner/", hint: "Find these in the Hetzner Console under Security → S3 credentials." },
  { kind: "r2", label: "Cloudflare R2", guide: "/docs/r2/", hint: "Create an API token under R2 → Manage API tokens. The account ID is on the R2 overview page." },
  { kind: "s3", label: "AWS S3", guide: "/docs/s3/", hint: "Create an access key in IAM → Users → Security credentials." },
];

const R2_ENDPOINT = /^https:\/\/([a-z0-9]+)\.r2\.cloudflarestorage\.com\/?$/i;
const HETZNER_LOCATION = /^[a-z0-9]+$/i;

function hetznerEndpointFor(region: string): string {
  return HETZNER_LOCATION.test(region) ? `https://${region}.your-objectstorage.com` : region;
}

export function formFromProfile(profile: ConnectionProfile | null): ConnectionForm {
  const empty: ConnectionForm = {
    kind: "hetzner", name: "", hetznerEndpoint: "", accountId: "", region: "", accessKeyId: "",
    secret: "", bucket: "", endpoint: "", pathStyle: false,
  };
  if (!profile) return empty;
  const { settings } = profile;
  const r2Account = settings.kind === "r2" ? settings.endpoint?.match(R2_ENDPOINT)?.[1] ?? "" : "";
  return {
    ...empty,
    kind: settings.kind,
    name: profile.name,
    hetznerEndpoint: settings.kind === "hetzner" ? hetznerEndpointFor(settings.region) : "",
    accountId: r2Account,
    region: settings.kind === "s3" ? settings.region : "",
    accessKeyId: settings.accessKeyId,
    bucket: profile.bucket ?? "",
    endpoint: r2Account || settings.kind === "hetzner" ? "" : settings.endpoint ?? "",
    pathStyle: settings.pathStyle,
  };
}

export function draftFromForm(form: ConnectionForm, id: string | null): ConnectionDraft {
  const override = form.kind === "hetzner" ? null : form.endpoint.trim() || null;
  const account = form.accountId.trim();
  const endpoint =
    form.kind === "r2" ? override ?? (account ? `https://${account}.r2.cloudflarestorage.com` : null) : override;
  const region = form.kind === "hetzner" ? form.hetznerEndpoint.trim() : form.kind === "r2" ? "auto" : form.region.trim();
  return {
    id,
    name: form.name.trim(),
    settings: { kind: form.kind, endpoint, region, pathStyle: form.pathStyle, accessKeyId: form.accessKeyId.trim() },
    bucket: form.bucket.trim() || null,
    secret: form.secret.trim() || null,
  };
}

type Status = { state: "idle" } | { state: "checking" } | { state: "ok"; result: CheckResult } | { state: "error"; error: AppError };

const FOCUSABLE = "input:not([disabled]):not([type=radio]), input[type=radio]:checked, button:not([disabled])";
const LOCATION_ERRORS = new Set(["invalidSettings"]);
const KEY_ERRORS = new Set(["badCredentials", "accessDenied"]);
const BUCKET_ERRORS = new Set(["notListable", "bucketNotFound"]);

function successText(result: CheckResult): string {
  if (result.limitedToBucket) return `Connected. This key can open ${result.buckets[0]}.`;
  const count = result.buckets.length;
  return `Connected. Found ${count} ${count === 1 ? "bucket" : "buckets"}.`;
}

type ConnectionSheetProps = {
  initial: ConnectionProfile | null;
  onSaved: (profile: ConnectionProfile) => void;
  onCancel: () => void;
};

export function ConnectionSheet({ initial, onSaved, onCancel }: ConnectionSheetProps) {
  const [form, setForm] = useState<ConnectionForm>(() => formFromProfile(initial));
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [showBucket, setShowBucket] = useState(Boolean(initial?.bucket));
  const [showAdvanced, setShowAdvanced] = useState(Boolean(formFromProfile(initial).endpoint || initial?.settings.pathStyle));
  const firstField = useRef<HTMLInputElement>(null);
  const sheet = useRef<HTMLFormElement>(null);
  const provider = PROVIDERS.find((p) => p.kind === form.kind) ?? PROVIDERS[0];
  const editing = initial !== null;
  const busy = status.state === "checking";

  useEffect(() => {
    firstField.current?.focus();
  }, []);

  const update = <K extends keyof ConnectionForm>(key: K, value: ConnectionForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setStatus({ state: "idle" });
  };

  const switchProvider = (kind: ProviderKind) => {
    setForm((current) => ({ ...current, kind, endpoint: "", pathStyle: false }));
    setStatus({ state: "idle" });
  };

  const trapFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!busy) onCancel();
      return;
    }
    if (event.key !== "Tab" || !sheet.current) return;
    const focusable = Array.from(sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const fail = (caught: unknown) => {
    const error = toAppError(caught);
    if (BUCKET_ERRORS.has(error.kind)) setShowBucket(true);
    setStatus({ state: "error", error });
  };

  const check = async () => {
    setStatus({ state: "checking" });
    try {
      setStatus({ state: "ok", result: await api.testConnection(draftFromForm(form, initial?.id ?? null)) });
    } catch (caught) {
      fail(caught);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setStatus({ state: "checking" });
    try {
      onSaved(await api.saveConnection(draftFromForm(form, initial?.id ?? null)));
    } catch (caught) {
      fail(caught);
    }
  };

  const error = status.state === "error" ? status.error : null;
  const errorAt = (place: "location" | "keys" | "bucket" | "form") => {
    if (!error) return null;
    const where = LOCATION_ERRORS.has(error.kind) ? "location" : KEY_ERRORS.has(error.kind) ? "keys" : BUCKET_ERRORS.has(error.kind) ? "bucket" : "form";
    return where === place ? (
      <p className="field-error" role="alert">
        {error.message}
      </p>
    ) : null;
  };

  return (
    <div className="sheet-backdrop" onKeyDown={trapFocus}>
      <form
        className="sheet"
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onSubmit={save}
      >
        <h2 id="sheet-title">{editing ? "Edit connection" : "Add a connection"}</h2>
        <p className="sheet-note">Your secret key is saved in the macOS Keychain.</p>

        <div className="sheet-body">
          <div className="provider-picker" role="radiogroup" aria-label="Provider">
            {PROVIDERS.map((option) => (
              <label key={option.kind} className={option.kind === form.kind ? "selected" : undefined}>
                <input
                  type="radio"
                  name="provider"
                  className="visually-hidden"
                  checked={option.kind === form.kind}
                  aria-label={option.label}
                  onChange={() => switchProvider(option.kind)}
                />
                <BrandLogo brand={option.kind} className={`provider-logo ${option.kind}`} />
                {option.label}
              </label>
            ))}
          </div>

          <div className="fields">
            <label htmlFor="f-name">Name</label>
            <input id="f-name" ref={firstField} value={form.name} onChange={(e) => update("name", e.target.value)} />

            {form.kind === "hetzner" && (
              <>
                <label htmlFor="f-hetzner-endpoint">Endpoint URL</label>
                <input
                  id="f-hetzner-endpoint"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://fsn1.your-objectstorage.com"
                  aria-describedby="f-hetzner-endpoint-hint"
                  value={form.hetznerEndpoint}
                  onChange={(e) => update("hetznerEndpoint", e.target.value)}
                />
                <p id="f-hetzner-endpoint-hint" className="field-hint">
                  Copy it from your bucket's overview under Object Storage in the Hetzner Console.
                </p>
              </>
            )}
            {form.kind === "r2" && (
              <>
                <label htmlFor="f-account">Account ID</label>
                <input id="f-account" value={form.accountId} onChange={(e) => update("accountId", e.target.value)} />
              </>
            )}
            {form.kind === "s3" && (
              <>
                <label htmlFor="f-region">Region</label>
                <input
                  id="f-region"
                  list="aws-regions"
                  placeholder="eu-west-2"
                  value={form.region}
                  onChange={(e) => update("region", e.target.value)}
                />
                <datalist id="aws-regions">
                  {["us-east-1", "us-west-2", "eu-west-1", "eu-west-2", "eu-central-1", "ap-southeast-1"].map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </>
            )}
            {errorAt("location")}
          </div>

          <div className="fields field-group keys">
            <label htmlFor="f-access">Access key</label>
            <input id="f-access" autoComplete="off" value={form.accessKeyId} onChange={(e) => update("accessKeyId", e.target.value)} />
            <label htmlFor="f-secret">Secret key</label>
            <input
              id="f-secret"
              type="password"
              autoComplete="off"
              placeholder={editing ? "Leave empty to keep the saved key" : undefined}
              value={form.secret}
              onChange={(e) => update("secret", e.target.value)}
            />
            <p className="field-hint">
              {provider.hint}{" "}
              <button type="button" className="link-button" onClick={() => api.openDocs(provider.guide)}>
                Open guide
              </button>
            </p>
            {errorAt("keys")}
          </div>

          {showBucket && (
            <div className="fields field-group bucket">
              <label htmlFor="f-bucket">Bucket name</label>
              <input id="f-bucket" value={form.bucket} onChange={(e) => update("bucket", e.target.value)} />
              {errorAt("bucket")}
            </div>
          )}

          <button type="button" className="link-button advanced-toggle" aria-expanded={showAdvanced} onClick={() => setShowAdvanced(!showAdvanced)}>
            Advanced settings
          </button>
          {showAdvanced && (
            <div className="fields">
              {form.kind !== "hetzner" && (
                <>
                  <label htmlFor="f-endpoint">Endpoint</label>
                  <input id="f-endpoint" placeholder="Use the provider's default" value={form.endpoint} onChange={(e) => update("endpoint", e.target.value)} />
                </>
              )}
              <span />
              <label className="check">
                <input type="checkbox" checked={form.pathStyle} onChange={(e) => update("pathStyle", e.target.checked)} />
                Path-style addressing
              </label>
            </div>
          )}
        </div>

        <div className="sheet-status" aria-live="polite">
          {status.state === "checking" && (
            <span>
              <span className="spinner" aria-hidden="true" /> Checking the connection
            </span>
          )}
          {status.state === "ok" && (
            <span className="ok">
              <span aria-hidden="true">✓</span> {successText(status.result)}
            </span>
          )}
          {errorAt("form")}
        </div>

        <div className="sheet-actions">
          <button type="button" className="button button-secondary" disabled={busy} onClick={check}>
            Test connection
          </button>
          <span className="spacer" />
          <button type="button" className="button button-secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            Save connection
          </button>
        </div>
      </form>
    </div>
  );
}
