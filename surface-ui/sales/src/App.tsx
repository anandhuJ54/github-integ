import { useState } from "react";
import { Button } from "@v3/ui";

// Minimal vertical slice: the SPA calls the FastAPI backend via /api (proxied by Vite),
// and renders the result. Uses the shared design-system Button from @v3/ui.
export function App() {
  const [reply, setReply] = useState<string>("(not called yet)");

  async function ping() {
    const res = await fetch("/api/sales/hello");
    const data = await res.json();
    setReply(`${data.message} — surface ${data.surface}`);
  }

  return (
    <main style={{ fontFamily: "system-ui", padding: 40 }}>
      <h1>web-sales</h1>
      <p>React SPA → FastAPI, one shared database.</p>
      <Button onClick={ping} style={{ padding: "8px 16px" }}>
        Call /api/sales/hello
      </Button>
      <pre style={{ marginTop: 16 }}>{reply}</pre>
    </main>
  );
}
