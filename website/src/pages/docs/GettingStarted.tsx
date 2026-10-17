import { DocsLayout } from "../../components/DocsLayout";
import { hrefFor } from "../../config";
import { KeychainCallout } from "../../content/docs-shared";
import { InstallSteps } from "../../content/install";

export default function GettingStarted() {
  return (
    <DocsLayout path="/docs" title="Getting started">
      <p>
        Kelp is a Mac app for browsing and moving files in Amazon S3, Cloudflare R2 and Hetzner Object Storage.
        This page gets you from download to your first bucket.
      </p>

      <h2>Install Kelp</h2>
      <InstallSteps />

      <h2>Add your first connection</h2>
      <ol className="steps" role="list">
        <li>
          <span>
            Get an access key from your provider. The guides for <a href={hrefFor("/docs/s3")}>Amazon S3</a>,{" "}
            <a href={hrefFor("/docs/r2")}>Cloudflare R2</a> and <a href={hrefFor("/docs/hetzner")}>Hetzner</a>{" "}
            show where to find one.
          </span>
        </li>
        <li>
          <span>
            In Kelp, choose <strong>Add connection</strong> and pick your provider.
          </span>
        </li>
        <li>
          <span>Paste your access key ID and secret access key, and fill in the settings from the guide.</span>
        </li>
        <li>
          <span>
            Choose <strong>Test connection</strong>. When it succeeds, choose <strong>Save</strong>.
          </span>
        </li>
      </ol>
      <KeychainCallout />

      <h2>Need help?</h2>
      <p>
        If a connection fails, the <a href={hrefFor("/docs/troubleshooting")}>troubleshooting guide</a> lists the
        common errors and how to fix them.
      </p>
    </DocsLayout>
  );
}
