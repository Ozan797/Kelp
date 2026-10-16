export type Release = { version: string };

const MANIFEST_URL = "https://dl.kelp.ozanai.dev/latest.json";

export function parseRelease(json: unknown): Release | null {
  if (typeof json !== "object" || json === null) return null;
  const version = (json as { version?: unknown }).version;
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? { version } : null;
}

export async function fetchRelease(): Promise<Release | null> {
  try {
    const response = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(5000) });
    return response.ok ? parseRelease(await response.json()) : null;
  } catch {
    return null;
  }
}
