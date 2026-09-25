// eslint-disable-next-line @next/next/no-html-link-for-pages
export default function Home() {
  return (
    <main style={{ padding: 32, fontFamily: "monospace", background: "#0E1014", color: "#EDEAE2", minHeight: "100vh" }}>
      <h1>WICK WIRE</h1>
      <p>your bag moved · here&apos;s why</p>
      <p>
        API: <a href="/api/board" style={{ color: "#FFB547" }}>/api/board</a> · <span>/api/stock/NVDA</span>
      </p>
    </main>
  );
}
