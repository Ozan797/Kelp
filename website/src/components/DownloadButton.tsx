import { DOWNLOAD_URL, SITE } from "../config";

export function DownloadButton({ large = false }: { large?: boolean }) {
  const size = large ? " button-lg" : "";
  if (!SITE.released) {
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
