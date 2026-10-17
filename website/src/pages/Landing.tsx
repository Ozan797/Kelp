import type { CSSProperties, ReactNode } from "react";
import { BrandLogo, type Brand } from "../components/BrandLogo";
import { Bubbles } from "../components/Bubbles";
import DemoWindow from "../components/DemoWindow";
import { DownloadButton } from "../components/DownloadButton";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { RELEASE, SITE, hrefFor } from "../config";
import { InstallSteps } from "../content/install";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

// Copy must match SPEC.md. No file search (it's "Later"), and no claim that files copy between providers without a download.
type Tile = { title: string; body: string; wide?: boolean; visual: ReactNode };

const TILES: Tile[] = [
  {
    title: "Three providers, one sidebar",
    body: "Connect Amazon S3, Cloudflare R2 and Hetzner Object Storage once. Switch between them without logging in again or opening another tool.",
    wide: true,
    visual: (
      <ul className="viz-providers" role="list">
        <li className="active">
          <BrandLogo brand="s3" className="side-logo s3" /> Amazon S3 <code>eu-west-2</code>
        </li>
        <li>
          <BrandLogo brand="r2" className="side-logo r2" /> Cloudflare R2 <code>auto</code>
        </li>
        <li>
          <BrandLogo brand="hetzner" className="side-logo hetzner" /> Hetzner <code>fsn1</code>
        </li>
      </ul>
    ),
  },
  {
    title: "Transfers that survive bad Wi-Fi",
    body: "Large files move in parallel pieces. Pause, resume, and let failed pieces retry on their own.",
    visual: (
      <ul className="viz-transfers" role="list">
        <li>
          <span>walkthrough.mp4</span>
          <span className="bar">
            <span className="bar-fill" />
          </span>
          <small>Uploading</small>
        </li>
        <li>
          <span>db-2026-10-13.sql.gz</span>
          <span className="bar">
            <span className="bar-fill slow" />
          </span>
          <small>Retrying in 8 s</small>
        </li>
        <li>
          <span>q2-export.parquet</span>
          <span className="bar">
            <span className="bar-fill paused" />
          </span>
          <small>Paused</small>
        </li>
      </ul>
    ),
  },
  {
    title: "Keyboard first",
    body: "Press ⌘K to jump to any bucket or folder, or run a command without reaching for the mouse.",
    visual: (
      <div className="viz-palette">
        <div className="viz-palette-input">
          <kbd>⌘</kbd>
          <kbd>K</kbd>
          <span>media-cdn/vid</span>
          <span className="caret" />
        </div>
        <div className="viz-palette-row active">media-cdn / videos</div>
        <div className="viz-palette-row">Upload files…</div>
      </div>
    ),
  },
  {
    title: "Drag and drop",
    body: "Drop files or whole folders onto the window to upload them. Drag between two connections to copy from one provider to another.",
    wide: true,
    visual: (
      <div className="viz-drop">
        <span className="viz-file">launch-teaser.mp4</span>
        <span className="viz-zone">Drop to upload to media-cdn/videos</span>
      </div>
    ),
  },
  {
    title: "Folders that behave like folders",
    body: "Create, move and delete folders. Before a big move or delete, Kelp tells you how many files it will touch.",
    wide: true,
    visual: (
      <div className="viz-dialog">
        <strong>Move 1,284 files to archive/2025?</strong>
        <span>Everything inside media-cdn/old will move.</span>
        <div>
          <span className="button button-secondary">Cancel</span>
          <span className="button button-primary">Move 1,284 files</span>
        </div>
      </div>
    ),
  },
  {
    title: "Quick previews",
    body: "Look at images, text and video right in the app, without saving them to your Mac first.",
    visual: (
      <figure className="viz-preview">
        <div className="viz-preview-window">
          <div className="viz-preview-head">
            <strong>hero-v3.webp</strong>
            <small>412 KB · 2 of 6</small>
            <span className="viz-step" aria-hidden="true">
              ‹
            </span>
            <span className="viz-step" aria-hidden="true">
              ›
            </span>
          </div>
          <span className="viz-image">
            <span className="viz-sun" />
            <span className="viz-hill viz-hill-back" />
            <span className="viz-hill viz-hill-front" />
          </span>
        </div>
        <figcaption>
          <kbd>Space</kbd> to open, <kbd>←</kbd> <kbd>→</kbd> for the next file
        </figcaption>
      </figure>
    ),
  },
];

const PROVIDERS: { brand: Brand; name: string; detail: string }[] = [
  { brand: "s3", name: "Amazon S3", detail: "Every AWS region" },
  { brand: "r2", name: "Cloudflare R2", detail: "Including EU jurisdiction" },
  { brand: "hetzner", name: "Hetzner", detail: "Object Storage in the EU" },
];

const STATS: { value: string; label: string; logo?: Brand }[] = [
  { logo: "rust", value: "Rust", label: "A native core does the heavy lifting, so the window never freezes." },
  { value: "4 at once", label: "Files transfer in parallel, and large ones move in parts." },
  { value: "100,000", label: "files in a folder still scroll smoothly. Only visible rows are drawn." },
];

const PRIVACY = [
  "Secret keys live only in the macOS Keychain.",
  "No analytics, no telemetry, no tracking.",
  "Files go straight to your provider, never through a Kelp server.",
];

function Arrow() {
  return (
    <svg className="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Landing() {
  return (
    <>
      <Header />
      <main id="main">
        <section className="band theme-dark hero" aria-labelledby="hero-title">
          <Bubbles followCursor />
          <div className="container hero-copy">
            <h1 id="hero-title" className="enter" style={stagger(0)}>
              Every bucket, <span className="text-gradient">one window.</span>
            </h1>
            <p className="lede enter" style={stagger(1)}>
              A fast Mac app for browsing and moving files across Amazon S3, Cloudflare R2 and Hetzner Object
              Storage.
            </p>
            <div className="hero-actions enter" style={stagger(2)}>
              <DownloadButton large />
              <a className="button button-ghost button-lg" href={hrefFor("/docs")}>
                Read the setup guide <Arrow />
              </a>
            </div>
            <p className="hero-note enter" style={stagger(3)}>
              For Apple Silicon Macs, {SITE.minMacOS} or later.
            </p>
          </div>
        </section>

        <div className="hero-demo enter" style={stagger(4)}>
          <div className="demo-stage">
            <DemoWindow />
          </div>
          <p className="demo-hint">This is a live preview with sample files. Click a folder to open it.</p>
        </div>

        <section className="container providers reveal" aria-label="Supported providers">
          <p>Works with</p>
          <ul className="provider-cards" role="list">
            {PROVIDERS.map((p) => (
              <li key={p.brand} className="provider-card">
                <span className={`provider-mark ${p.brand}`}>
                  <BrandLogo brand={p.brand} />
                </span>
                <span className="provider-text">
                  <strong>{p.name}</strong>
                  <span>{p.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="container section" id="features" aria-labelledby="features-title">
          <header className="section-head reveal">
            <p className="kicker">Features</p>
            <h2 id="features-title">
              Everything your buckets need.
              <br />
              Nothing they don't.
            </h2>
          </header>
          <div className="bento">
            {TILES.map((tile) => (
              <article key={tile.title} className={tile.wide ? "tile tile-wide reveal" : "tile reveal"}>
                <div className="tile-copy">
                  <h3>{tile.title}</h3>
                  <p>{tile.body}</p>
                </div>
                <div className="tile-visual" aria-hidden="true">
                  {tile.visual}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="container section speed" aria-labelledby="speed-title">
          <header className="section-head reveal">
            <p className="kicker">Performance</p>
            <h2 id="speed-title">Built to stay fast.</h2>
            <p className="section-intro">Kelp is designed around one rule: the interface never waits for the network.</p>
          </header>
          <ul className="stats" role="list">
            {STATS.map((stat) => (
              <li key={stat.value} className="reveal">
                <strong>
                  {stat.logo && <BrandLogo brand={stat.logo} className="stat-logo" />}
                  {stat.value}
                </strong>
                <span>{stat.label}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="band theme-dark security" aria-labelledby="security-title">
          <div className="container security-grid">
            <div className="reveal">
              <svg className="lock" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <rect x="9" y="21" width="30" height="21" rx="5" />
                <path d="M16 21v-6a8 8 0 0 1 16 0v6" strokeLinecap="round" />
                <circle cx="24" cy="31" r="2.5" fill="currentColor" stroke="none" />
              </svg>
              <h2 id="security-title">Your keys stay in the macOS Keychain.</h2>
              <p>
                The same place macOS keeps your passwords. Kelp never writes them to a settings file or a log, or sends
                them anywhere except your storage provider.
              </p>
              <p>
                <a href={hrefFor("/privacy")}>
                  Read how Kelp handles your data <Arrow />
                </a>
              </p>
            </div>
            <ul className="checklist reveal" role="list">
              {PRIVACY.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="container section" id="download" aria-labelledby="download-title">
          <div className="cta-card reveal">
            <h2 id="download-title">Get {SITE.name}</h2>
            <p className="download-meta">
              {RELEASE ? `Version ${RELEASE.version} for Apple Silicon, ${SITE.minMacOS} or later.` : `For Apple Silicon, ${SITE.minMacOS} or later.`}
            </p>
            <DownloadButton large />
            <div className="cta-steps">
              <InstallSteps />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
