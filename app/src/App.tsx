import mark from "../../design/brand/kelp-mark.svg";

/** Placeholder window until milestone M2 adds connections, buckets and the file list. */
export default function App() {
  return (
    <main className="welcome">
      <img src={mark} alt="" width="72" height="72" />
      <h1>Welcome to Kelp</h1>
      <p>Connections and buckets are coming in the next build.</p>
    </main>
  );
}
