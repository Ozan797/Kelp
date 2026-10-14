import { DocsLayout } from "../../components/DocsLayout";
import { AddConnectionSteps, KeychainCallout, SettingsTable } from "../../content/docs-shared";

export default function S3() {
  return (
    <DocsLayout path="/docs/s3" title="Connect Amazon S3">
      <p>
        To connect Amazon S3, Kelp needs an access key for an IAM user. Give that user access to only the buckets it
        needs.
      </p>

      <h2>Create an access key</h2>
      <ol className="steps" role="list">
        <li>
          <span>
            Sign in to the AWS console and open <strong>IAM → Users</strong>. Choose <strong>Create user</strong> and
            give it a name such as <code>kelp</code>.
          </span>
        </li>
        <li>
          <span>
            Attach a policy. <code>AmazonS3ReadOnlyAccess</code> is enough to browse and download. To upload and
            delete, use a policy that also allows <code>s3:PutObject</code> and <code>s3:DeleteObject</code> on your
            buckets.
          </span>
        </li>
        <li>
          <span>
            Open the new user, go to <strong>Security credentials</strong> and choose{" "}
            <strong>Create access key</strong>. Pick <strong>Application running outside AWS</strong> as the use
            case.
          </span>
        </li>
        <li>
          <span>Copy the access key ID and the secret access key. AWS shows the secret only once.</span>
        </li>
      </ol>

      <h2>Connection settings</h2>
      <SettingsTable
        rows={[
          [
            "Region",
            <>
              The region your buckets are in, for example <code>eu-west-2</code>. The S3 console shows it next to
              each bucket.
            </>,
          ],
          ["Endpoint", "Leave empty. Kelp uses the standard AWS endpoint for the region."],
          ["Path-style addressing", "Off."],
        ]}
      />

      <h2>Add it to Kelp</h2>
      <AddConnectionSteps provider="Amazon S3" />
      <KeychainCallout />
    </DocsLayout>
  );
}
