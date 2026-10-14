import { DocsLayout } from "../../components/DocsLayout";
import { SITE } from "../../config";

export default function Troubleshooting() {
  return (
    <DocsLayout path="/docs/troubleshooting" title="Troubleshooting">
      <p>Most connection problems come from a mistyped value. Find the message Kelp shows below.</p>

      <h2>The signature doesn't match</h2>
      <p>
        The secret access key is wrong or incomplete. Copy it again from your provider and check that no spaces were
        added at either end. Also check that the region matches your bucket.
      </p>

      <h2>Access denied</h2>
      <p>
        The key works, but it isn't allowed to do this. Check the permissions or policy attached to the key in your
        provider's console.
      </p>

      <h2>No buckets are listed</h2>
      <p>
        Some keys can read objects but can't list buckets, for example Cloudflare R2 tokens limited to specific
        buckets. Give the key permission to list buckets, or create a new key with wider access.
      </p>

      <h2>Kelp can't reach the endpoint</h2>
      <p>
        Check the endpoint for typos and make sure it starts with <code>https://</code>. A company firewall or VPN may
        also block it. If the error mentions a host name that contains your bucket name, turn on path-style
        addressing for the connection.
      </p>

      <h2>The request time is too far off</h2>
      <p>
        Your Mac's clock is wrong. Open <strong>System Settings → General → Date &amp; Time</strong> and turn on{" "}
        <strong>Set time and date automatically</strong>.
      </p>

      <h2>macOS won't open Kelp</h2>
      <p>
        If macOS says it can't check the app, open <strong>System Settings → Privacy &amp; Security</strong> and
        choose <strong>Open Anyway</strong>.
      </p>

      <h2>Still stuck?</h2>
      <p>
        <a href={`${SITE.repoUrl}/issues`}>Open an issue on GitHub</a> and include the message Kelp shows. Never
        include your secret key.
      </p>
    </DocsLayout>
  );
}
