import { Bubbles } from "../components/Bubbles";
import DemoWindow from "../components/DemoWindow";
import { DownloadButton } from "../components/DownloadButton";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { SITE, hrefFor } from "../config";
import { InstallSteps } from "../content/install";

// Copy must match SPEC.md. No file search (it's "Later"), and no claim that files copy between providers without a download.
const FEATURES = [
  {
    title: "Three providers, one sidebar",
    body: "Connect Amazon S3, Cloudflare R2 and Hetzner Object Storage once. Switch between them without logging in again or opening another tool.",
  },
  {
    title: "Transfers that survive bad Wi-Fi",
    body: "Large files upload and download in parallel pieces. Pause, resume, and let failed pieces retry on their own.",
  },
  {
    title: "Keyboard first",
    body: "Press ⌘K to jump to any bucket or folder, or run a command without reaching for the mouse.",
  },
  {
    title: "Drag and drop",
    body: "Drop files or whole folders onto the window to upload them. Drag between two connections to copy from one provider to another.",
  },
  {
    title: "Folders that behave like folders",
    body: "Create, rename and delete folders. Before a big move or delete, Kelp tells you how many files it will touch.",
  },
  {
    title: "Quick previews",
    body: "Look at images, text and video right in the app, without saving them to your Mac first.",
  },
];

const PROVIDERS = ["Amazon S3", "Cloudflare R2", "Hetzner Object Storage"];

export default function Landing() {
  return (
    <>
      <Header />
      <main id="main">
        <section className="band theme-dark hero" aria-labelledby="hero-title">
          <Bubbles />
          <div className="container hero-copy">
            <h1 id="hero-title">Every bucket, one window.</h1>
            <p className="lede">
              A fast Mac app for browsing and moving files across Amazon S3, Cloudflare R2 and Hetzner Object
              Storage.
            </p>
            <div className="hero-actions">
              <DownloadButton large />
              <p className="hero-note">For Apple Silicon Macs, {SITE.minMacOS} or later.</p>
            </div>
          </div>
        </section>

        <div className="hero-demo">
          <DemoWindow />
          <p className="demo-hint">This is a live preview with sample files. Click a folder to open it.</p>
        </div>

        <section className="container providers" aria-label="Supported providers">
          <p>Works with</p>
          <ul role="list">
            {PROVIDERS.map((name) => (
              <li key={name} className="badge">
                {name}
              </li>
            ))}
          </ul>
        </section>

        <section className="container section" id="features" aria-labelledby="features-title">
          <h2 id="features-title">What Kelp does</h2>
          <ul className="feature-grid" role="list">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="card">
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="band theme-dark security" aria-labelledby="security-title">
          <div className="container">
            <h2 id="security-title">Your keys stay in the macOS Keychain</h2>
            <p>
              Kelp saves your secret access keys in the Keychain, the same place macOS keeps your passwords. They
              never go into a settings file or a log, or anywhere except your storage provider.
            </p>
            <p>
              <a href={hrefFor("/privacy")}>Read how Kelp handles your data</a>
            </p>
          </div>
        </section>

        <section className="container section" id="download" aria-labelledby="download-title">
          <div className="download-grid">
            <div>
              <h2 id="download-title">Get {SITE.name}</h2>
              <p className="download-meta">
                Version {SITE.version} for Apple Silicon, {SITE.minMacOS} or later.
              </p>
              <DownloadButton large />
            </div>
            <InstallSteps />
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
