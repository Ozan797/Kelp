import { ArticleLayout } from "../components/ArticleLayout";
import { SITE } from "../config";

export default function Privacy() {
  return (
    <ArticleLayout
      title="Privacy"
      intro="Kelp keeps your data on your Mac and with your storage providers. Nothing else."
    >
      <h2>Your keys</h2>
      <p>
        Kelp saves each secret access key in the macOS Keychain, the same place macOS keeps your passwords. Secret
        keys are never written to Kelp's settings files, logs or crash reports.
      </p>

      <h2>Your files</h2>
      <p>
        Files move directly between your Mac and your storage provider. They never pass through a Kelp server,
        because there isn't one.
      </p>

      <h2>What Kelp connects to</h2>
      <ul>
        <li>The storage providers you add.</li>
        <li>GitHub, to check for and download updates.</li>
      </ul>

      <h2>Analytics</h2>
      <p>Kelp has no analytics or telemetry. It doesn't track how you use the app.</p>

      <h2>This website</h2>
      <p>
        This site sets no cookies and has no analytics. It saves your theme choice in your browser's local storage,
        and nothing else.
      </p>

      <h2>Questions</h2>
      <p>
        <a href={`${SITE.repoUrl}/issues`}>Open an issue on GitHub</a> if anything here is unclear.
      </p>

      <p>Last updated 14 October 2026.</p>
    </ArticleLayout>
  );
}
