import type { ReactElement } from "react";
import { FolderMemoryScene } from "../components/FolderMemoryScene";
import { ArticleLayout } from "../components/ArticleLayout";
import { UpdateReadyScene } from "../components/UpdateReadyScene";
import { RELEASE } from "../config";
import { changeGroups, publishedNotes, type ReleaseNote } from "../notes";

export const SCENES: Partial<Record<NonNullable<ReleaseNote["scene"]>, () => ReactElement>> = {
  "folder-memory": FolderMemoryScene,
  "update-ready": UpdateReadyScene,
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
      <p className="release-meta">
        <span>{note.version}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={note.date}>{formatDate(note.date)}</time>
        {latest && <span className="release-latest">Latest</span>}
      </p>
      <h2 id={`release-${note.version}`}>{note.title}</h2>
      <p className="release-summary">{note.summary}</p>
      {Scene && (
        <div className="release-media">
          <Scene />
        </div>
      )}
      {changeGroups(note.changes).map((group) => (
        <div key={group.kind} className={`release-group release-group-${group.kind}`}>
          <h3>{group.label}</h3>
          <ul role="list">
            {group.changes.map((change) => (
              <li key={change.title}>
                <strong>{change.title}.</strong> {change.body}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default function WhatsNew() {
  const notes = publishedNotes(RELEASE?.version ?? null);
  return (
    <ArticleLayout centred title="What's new in Kelp" intro="What changed in each version, newest first.">
      {notes.length === 0 ? (
        <p>The first release is on its way.</p>
      ) : (
        notes.map((note, i) => <Release key={note.version} note={note} latest={i === 0} />)
      )}
    </ArticleLayout>
  );
}
