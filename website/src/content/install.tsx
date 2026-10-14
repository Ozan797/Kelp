/** Install steps, shared by the landing page and the Getting started docs page. */
export function InstallSteps() {
  return (
    <ol className="steps" role="list">
      <li>
        <span>
          Download the <code>.dmg</code> file.
        </span>
      </li>
      <li>
        <span>Open it and drag Kelp into your Applications folder.</span>
      </li>
      {/* Remove this step once the app is notarised (SPEC.md milestone M5). */}
      <li>
        <span>
          Open Kelp. If macOS says it can't check the app, open{" "}
          <strong>System Settings → Privacy &amp; Security</strong> and choose <strong>Open Anyway</strong>.
        </span>
      </li>
    </ol>
  );
}
