export default function Home() {
  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Skippy OS</h1>
      <p className="mt-3 text-base leading-7">
        Phase 0: the OAuth test. The dashboard is not built yet. The Skippy MCP endpoint is at{" "}
        <code className="font-mono text-sm">/api/mcp</code>.
      </p>
    </main>
  );
}
