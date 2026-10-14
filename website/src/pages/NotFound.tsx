import type { CSSProperties } from "react";
import { Bubbles } from "../components/Bubbles";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

export default function NotFound() {
  return (
    <>
      <Header />
      <main id="main" className="band theme-dark not-found">
        <Bubbles followCursor />
        <div className="container not-found-body">
          <h1 className="enter" style={stagger(0)}>
            This page drifted off.
          </h1>
          <p className="enter" style={stagger(1)}>
            The link may be old, or the page may have moved.
          </p>
          <p className="enter" style={stagger(2)}>
            <a className="button button-primary button-lg" href="/">
              Go to the home page
            </a>
          </p>
        </div>
      </main>
      <Footer />
    </>
  );
}
