import { DocsLayout } from "../../components/DocsLayout";
import { AddConnectionSteps, KeychainCallout, SettingsTable } from "../../content/docs-shared";

export default function Hetzner() {
  return (
    <DocsLayout path="/docs/hetzner" title="Connect Hetzner Object Storage">
      <p>
        Hetzner Object Storage is S3-compatible. Kelp connects to it with S3 credentials from your Hetzner Cloud
        project.
      </p>

      <h2>Create an access key</h2>
      <ol className="steps" role="list">
        <li>
          <span>Open the Hetzner Console and select the project that holds your buckets.</span>
        </li>
        <li>
          <span>
            Go to <strong>Security → S3 credentials</strong> and choose <strong>Generate credentials</strong>.
          </span>
        </li>
        <li>
          <span>Copy the access key and the secret key. Hetzner shows the secret only once.</span>
        </li>
      </ol>

      <h2>Connection settings</h2>
      <SettingsTable
        rows={[
          [
            "Region",
            <>
              The location of your buckets: <code>fsn1</code> (Falkenstein), <code>nbg1</code> (Nuremberg) or{" "}
              <code>hel1</code> (Helsinki).
            </>,
          ],
          [
            "Endpoint",
            <>
              <code>{"https://<location>.your-objectstorage.com"}</code>, for example{" "}
              <code>https://fsn1.your-objectstorage.com</code>.
            </>,
          ],
          ["Path-style addressing", "Off."],
        ]}
      />

      <h2>Add it to Kelp</h2>
      <AddConnectionSteps provider="Hetzner" />
      <KeychainCallout />
    </DocsLayout>
  );
}
