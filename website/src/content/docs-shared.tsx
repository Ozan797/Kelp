import type { ReactNode } from "react";

export function KeychainCallout() {
  return (
    <p className="callout callout-info">
      Kelp saves your secret access key in the macOS Keychain. It's never written to a settings file or a log.
    </p>
  );
}

export function AddConnectionSteps({ provider }: { provider: string }) {
  return (
    <ol className="steps" role="list">
      <li>
        <span>
          In Kelp, choose <strong>Add connection</strong> and pick <strong>{provider}</strong>.
        </span>
      </li>
      <li>
        <span>Enter a name you'll recognise, then paste your access key ID and secret access key.</span>
      </li>
      <li>
        <span>Fill in the connection settings from the table above.</span>
      </li>
      <li>
        <span>
          Choose <strong>Test connection</strong>. When it succeeds, choose <strong>Save</strong>.
        </span>
      </li>
    </ol>
  );
}

export function SettingsTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col">Setting</th>
          <th scope="col">What to enter</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
