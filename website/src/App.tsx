import DemoWindow from "./components/DemoWindow";
import { SITE } from "./config";

const features = [
  {
    title: "Three providers, one sidebar",
    body: "Connect Amazon S3, Cloudflare R2 and Hetzner Object Storage once. Switch between them without logging in again or opening another tool.",
  },
  {
    title: "Transfers that survive bad Wi-Fi",
    body: "Large files upload and download in parallel pieces. Pause, resume, and let failed pieces retry on their own.",
  },
  {
    title: "Keys stay in your Keychain",
    body: "Access keys are stored in the macOS Keychain. They are never written to a settings file or sent anywhere except your provider.",
  },
  {
    title: "Copy between providers",
    body: "Drag a folder from R2 into Hetzner and the app handles the copy. No download to your Mac first when the provider supports it.",
  },
  {
    title: "Search and keyboard first",
    body: "Press ⌘K to jump to any bucket or folder, find a file by name, or run a command without reaching for the mouse.",
  },
];

const steps = [
  "Download the .dmg file.",
  "Open it and drag the app into Applications.",
  "First launch only: right-click the app and choose Open if macOS asks you to confirm.",
];

function DownloadButton({ large = false }: { large?: boolean }) {
  const cls = large ? "button button-large" : "button";
  if (!SITE.released) {
    return (
      <span className={`${cls} button-pending`} role="status">
        Download coming soon
      </span>
    );
  }
  return (
    <a className={cls} href={SITE.downloadUrl}>
      Download for Mac
    </a>
  );
}

export default function App() {
  return (
    <>
      <header className="site-header">
        <a className="brand" href="#top">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="15" fill="currentColor" />
            <path d="M16 22h32l-4 26a4 4 0 0 1-4 3H24a4 4 0 0 1-4-3z" fill="#fff" />
            <ellipse cx="32" cy="22" rx="16" ry="5" fill="#cfd1ff" />
          </svg>
          {SITE.name}
        </a>
        <nav className="header-nav" aria-label="Page">
          <a href="#features">Features</a>
          <a href="#download">Download</a>
          <a href={SITE.repoUrl}>GitHub</a>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>Every bucket, one window.</h1>
            <p className="lede">
              A fast Mac app for browsing and moving files across Amazon S3,
              Cloudflare R2 and Hetzner Object Storage.
            </p>
            <div className="hero-actions">
              <DownloadButton />
              <p className="hero-note">
                For Apple Silicon Macs, {SITE.minMacOS} or later.
              </p>
            </div>
          </div>

          <div className="hero-demo">
            <DemoWindow />
            <p className="demo-hint">
              This is a live preview. Click a folder to open it.
            </p>
          </div>
        </section>

        <section className="features" id="features">
          <h2>What it does</h2>
          <dl>
            {features.map((feature) => (
              <div className="feature" key={feature.title}>
                <dt>{feature.title}</dt>
                <dd>{feature.body}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="built">
          <h2>Built to stay out of your way</h2>
          <p>
            The core is written in Rust, so it opens quickly, uses little
            memory, and keeps transfers running in the background while the
            interface stays responsive. The interface itself is a modern web
            view inside a native Mac app, not a browser tab.
          </p>
        </section>

        <section className="download" id="download">
          <div className="download-inner">
            <div>
              <h2>Get {SITE.name}</h2>
              <p className="download-meta">
                Version {SITE.version} for Apple Silicon, {SITE.minMacOS} or
                later.
              </p>
              <DownloadButton large />
            </div>
            <ol className="steps">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <span>{SITE.domain}</span>
        <a href={SITE.repoUrl}>Source on GitHub</a>
      </footer>
    </>
  );
}
