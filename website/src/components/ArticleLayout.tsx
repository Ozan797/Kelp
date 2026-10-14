import type { CSSProperties, ReactNode } from "react";
import { Bubbles } from "./Bubbles";
import { Footer } from "./Footer";
import { Header } from "./Header";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** Page with a navy title band and a reading-width article below it. */
export function ArticleLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <>
      <Header />
      <main id="main">
        <div className="band theme-dark">
          <Bubbles />
          <div className="container band-title">
            <h1 className="enter" style={stagger(0)}>
              {title}
            </h1>
            <p className="enter" style={stagger(1)}>
              {intro}
            </p>
          </div>
        </div>
        <article className="container article enter" style={stagger(2)}>
          <div className="prose">{children}</div>
        </article>
      </main>
      <Footer />
    </>
  );
}
