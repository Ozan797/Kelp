import type { ReactNode } from "react";
import { Footer } from "./Footer";
import { Header } from "./Header";

export function ArticleLayout({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <>
      <Header />
      <main id="main">
        <div className="band theme-dark">
          <div className="container band-title">
            <h1>{title}</h1>
            <p>{intro}</p>
          </div>
        </div>
        <article className="container article">
          <div className="prose">{children}</div>
        </article>
      </main>
      <Footer />
    </>
  );
}
