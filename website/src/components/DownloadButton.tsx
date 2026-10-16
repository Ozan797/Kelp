import { DOWNLOAD_URL, RELEASE } from "../config";

export function DownloadButton({ large = false }: { large?: boolean }) {
  const size = large ? " button-lg" : "";
  if (!RELEASE || !DOWNLOAD_URL) {
    return (
      <span className={`button button-secondary${size}`} aria-disabled="true">
        Download coming soon
      </span>
    );
  }
  return (
    <a className={`button button-primary${size}`} href={DOWNLOAD_URL}>
      Download for Mac
    </a>
  );
}
