export type Release = { version: string };

const DOWNLOADS = "https://kelp-dl.ozanai.dev";
const MANIFEST_URL = `${DOWNLOADS}/latest.json`;

export function parseRelease(json: unknown): Release | null {
  if (typeof json !== "object" || json === null) return null;
  const version = (json as { version?: unknown }).version;
  return typeof version === "string" && /^\d+\.\d+\.\d+$/.test(version) ? { version } : null;
}

export function releaseFromVersion(version: string): Release | null {
  const release = parseRelease({ version });
  if (!release) console.warn(`The deploy handed over "${version}", which isn't a version like 0.1.0. Building without a release.`);
  return release;
}

export const downloadUrl = ({ version }: Release) => `${DOWNLOADS}/releases/${version}/Kelp_${version}_aarch64.dmg`;

export async function fetchRelease(): Promise<Release | null> {
  try {
    const response = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      console.warn(`Couldn't read ${MANIFEST_URL}: HTTP ${response.status}. Building without a release.`);
      return null;
    }
    const release = parseRelease(await response.json());
    if (!release) console.warn(`${MANIFEST_URL} has no valid version. Building without a release.`);
    return release;
  } catch (error) {
    console.warn(`Couldn't read ${MANIFEST_URL}: ${String(error)}. Building without a release.`);
    return null;
  }
}
