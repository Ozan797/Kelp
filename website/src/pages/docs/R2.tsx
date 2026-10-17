import { DocsLayout } from "../../components/DocsLayout";
import { hrefFor } from "../../config";
import { AddConnectionSteps, KeychainCallout, SettingsTable } from "../../content/docs-shared";

export default function R2() {
  return (
    <DocsLayout path="/docs/r2" title="Connect Cloudflare R2">
      <p>
        Cloudflare R2 speaks the S3 API, so Kelp connects to it with the access key from an R2 API token.
      </p>

      <h2>Create an access key</h2>
      <ol className="steps" role="list">
        <li>
          <span>
            In the Cloudflare dashboard, open <strong>R2 Object Storage</strong>. Copy your{" "}
            <strong>Account ID</strong> from the overview page. You need it for the endpoint.
          </span>
        </li>
        <li>
          <span>
            Choose <strong>Manage API tokens</strong>, then <strong>Create API token</strong>.
          </span>
        </li>
        <li>
          <span>
            Give it the <strong>Object Read &amp; Write</strong> permission. If you limit it to specific buckets, see{" "}
            <a href={hrefFor("/docs/troubleshooting")}>This key can't list buckets</a>.
          </span>
        </li>
        <li>
          <span>
            Create the token and copy the <strong>Access Key ID</strong> and <strong>Secret Access Key</strong>.
            Cloudflare shows the secret only once.
          </span>
        </li>
      </ol>

      <h2>Connection settings</h2>
      <SettingsTable
        rows={[
          [
            "Region",
            <>
              <code>auto</code>
            </>,
          ],
          [
            "Endpoint",
            <>
              <code>{"https://<ACCOUNT_ID>.r2.cloudflarestorage.com"}</code>, with your account ID in place of{" "}
              <code>{"<ACCOUNT_ID>"}</code>. For buckets in the EU jurisdiction, use{" "}
              <code>{"https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com"}</code>.
            </>,
          ],
          ["Path-style addressing", "Off."],
        ]}
      />

      <h2>Add it to Kelp</h2>
      <AddConnectionSteps provider="Cloudflare R2" />
      <KeychainCallout />
    </DocsLayout>
  );
}
