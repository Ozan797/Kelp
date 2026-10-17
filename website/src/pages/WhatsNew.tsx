import type { ReactElement } from "react";
import { FolderMemoryScene } from "../components/FolderMemoryScene";
import { ArticleLayout } from "../components/ArticleLayout";
import { RELEASE } from "../config";
import { publishedNotes, type ReleaseNote } from "../notes";

export const SCENES: Partial<Record<NonNullable<ReleaseNote["scene"]>, () => ReactElement>> = {
  "folder-memory": FolderMemoryScene,
};

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

function Release({ note, latest }: { note: ReleaseNote; latest: boolean }) {
  const Scene = note.scene ? SCENES[note.scene] : undefined;
  return (
    <section id={note.version} className="release" aria-labelledby={`release-${note.version}`}>
      <h2 id={`release-${note.version}`}>
        {note.version}
        {latest && <span className="release-latest">Latest</span>}
      </h2>
      <time dateTime={note.date}>{formatDate(note.date)}</time>
      <p>{note.summary}</p>
      {Scene && <Scene />}
      <ul role="list">
        {note.changes.map((change) => (
          <li key={change.title}>
            <strong>{change.title}.</strong> {change.body}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function WhatsNew() {
  const notes = publishedNotes(RELEASE?.version ?? null);
  return (
    <ArticleLayout title="What's new in Kelp" intro="What changed in each version, newest first.">
      {notes.length === 0 ? (
        <p>The first release is on its way.</p>
      ) : (
        notes.map((note, i) => <Release key={note.version} note={note} latest={i === 0} />)
      )}
    </ArticleLayout>
  );
}
