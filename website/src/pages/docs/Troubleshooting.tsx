import { DocsLayout } from "../../components/DocsLayout";

export default function Troubleshooting() {
  return (
    <DocsLayout path="/docs/troubleshooting" title="Troubleshooting">
      <p>Most connection problems come from a mistyped value. Find the message Kelp shows below.</p>

      <h2>"The secret key doesn't match the access key ID"</h2>
      <p>
        The secret access key is wrong or incomplete. Copy it again from your provider and check that no spaces were
        added at either end. Also check that the region matches your bucket.
      </p>

      <h2>"Access denied"</h2>
      <p>
        The key works, but it isn't allowed to do this. Check the permissions or policy attached to the key in your
        provider's console.
      </p>

      <h2>"This key can't list buckets"</h2>
      <p>
        Some keys can open a bucket but can't list them, for example Cloudflare R2 tokens limited to specific
        buckets. Kelp shows a <strong>Bucket</strong> field: type the bucket's name and Kelp opens just that one.
      </p>

      <h2>"The bucket … doesn't exist, or this key can't see it"</h2>
      <p>
        Check the bucket name for typos, and that the region or location matches the one the bucket was created in.
      </p>

      <h2>"This connection has no buckets yet"</h2>
      <p>The key works and the account is empty. Create a bucket in your provider's console, then come back.</p>

      <h2>"Kelp couldn't reach the storage provider"</h2>
      <p>
        Check the endpoint for typos and make sure it starts with <code>https://</code>. A company firewall or VPN may
        also block it. If the error mentions a host name that contains your bucket name, turn on path-style
        addressing for the connection.
      </p>

      <h2>"Your Mac's clock is too far off for the provider"</h2>
      <p>
        Your Mac's clock is wrong. Open <strong>System Settings → General → Date &amp; Time</strong> and turn on{" "}
        <strong>Set time and date automatically</strong>.
      </p>

      <h2>macOS won't open Kelp</h2>
      <p>
        If macOS says it can't check the app, open <strong>System Settings → Privacy &amp; Security</strong> and
        choose <strong>Open Anyway</strong>.
      </p>
    </DocsLayout>
  );
}
