import type { CSSProperties, ReactNode } from "react";
import { BrandLogo, type Brand } from "../components/BrandLogo";
import { Bubbles } from "../components/Bubbles";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

const icon = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const PROMISES = [
  {
    title: "Keys stay in your Keychain",
    body: "Secret access keys go into the macOS Keychain, the same place macOS keeps your passwords. Never into a settings file, a log or a crash report.",
    icon: icon(
      <>
        <circle cx="8" cy="15" r="4" />
        <path d="M11 12l9-9M17 6l3 3M15 8l2 2" />
      </>,
    ),
  },
  {
    title: "Files go straight to your provider",
    body: "Uploads and downloads move directly between your Mac and your storage. There is no Kelp server for them to pass through.",
    icon: icon(
      <>
        <path d="M4 12h13M13 7l5 5-5 5" />
        <path d="M20 4v16" />
      </>,
    ),
  },
  {
    title: "No tracking",
    body: "No analytics, no telemetry, no crash reporting services. Kelp doesn't know how, or how much, you use it.",
    icon: icon(
      <>
        <path d="M3 3l18 18" />
        <path d="M10.6 5.1A10 10 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4M6.6 6.6C4.2 8 2.6 10.2 2 12c1 2.5 5 7 10 7a9.6 9.6 0 0 0 4.4-1.1" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      </>,
    ),
  },
];

const STORED: { what: string; where: string }[] = [
  { what: "Secret access keys", where: "The macOS Keychain, and nowhere else." },
  {
    what: "Connection details",
    where: "Name, provider, region, endpoint and access key ID, in a settings file in Kelp's folder on your Mac.",
  },
  { what: "Last bucket and folder", where: "The same settings file, so each connection reopens where you left off." },
  { what: "Bucket size counts", where: "Saved on your Mac, so you don't have to count again." },
  { what: "Your files", where: "With your storage provider. Kelp only saves a copy on your Mac when you download it." },
];

const CONNECTS: { brand: Brand; name: string; why: string }[] = [
  { brand: "s3", name: "Amazon S3", why: "Only if you add an S3 connection." },
  { brand: "r2", name: "Cloudflare R2", why: "Only if you add an R2 connection." },
  { brand: "hetzner", name: "Hetzner", why: "Only if you add a Hetzner connection." },
  { brand: "r2", name: "Cloudflare", why: "To check for updates and download them, from kelp-dl.ozanai.dev." },
];

export default function Privacy() {
  return (
    <>
      <Header />
      <main id="main">
        <section className="band theme-dark" aria-labelledby="privacy-title">
          <Bubbles />
          <div className="container band-title privacy-head">
            <p className="kicker enter" style={stagger(0)}>
              Privacy
            </p>
            <h1 id="privacy-title" className="enter" style={stagger(1)}>
              Your data stays yours.
            </h1>
            <p className="enter" style={stagger(2)}>
              Kelp keeps your data on your Mac and with your storage providers. Nothing else.
            </p>
          </div>
        </section>

        <section className="container section" aria-label="The short version">
          <ul className="promise-grid" role="list">
            {PROMISES.map((p) => (
              <li key={p.title} className="promise reveal">
                <span className="promise-icon">{p.icon}</span>
                <h2>{p.title}</h2>
                <p>{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="container section privacy-section" aria-labelledby="stored-title">
          <header className="section-head reveal">
            <p className="kicker">In detail</p>
            <h2 id="stored-title">What's stored, and where.</h2>
          </header>
          <dl className="stored-list reveal">
            {STORED.map((row) => (
              <div key={row.what}>
                <dt>{row.what}</dt>
                <dd>{row.where}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="container section privacy-section" aria-labelledby="connects-title">
          <header className="section-head reveal">
            <p className="kicker">Network</p>
            <h2 id="connects-title">Who Kelp talks to.</h2>
            <p className="section-intro">The services below, and nothing else. No ad networks, no analytics.</p>
          </header>
          <ul className="connects-grid" role="list">
            {CONNECTS.map((c) => (
              <li key={c.brand} className="provider-card reveal">
                <span className={`provider-mark ${c.brand}`}>
                  <BrandLogo brand={c.brand} />
                </span>
                <span className="provider-text">
                  <strong>{c.name}</strong>
                  <span>{c.why}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="site-note reveal">
            This website sets no cookies and has no analytics. It saves your theme choice in your browser, and nothing
            else.
          </p>
          <p className="site-note reveal">Last updated 17 October 2026.</p>
        </section>

      </main>
      <Footer />
    </>
  );
}
