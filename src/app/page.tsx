export default function HomePage() {
  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">PRISM</div>
        <div className="status">Early build · STRK20 Private Sprint</div>
      </header>

      <section className="hero">
        <p className="eyebrow">Starknet-native identity</p>
        <h1>One Prism ID.<br />One home across chains.</h1>
        <p className="lede">
          Persistent identity on Starknet, native execution across connected accounts,
          and private financial state through STRK20.
        </p>
      </section>

      <section className="proof">
        <div>
          <span className="label">First proof</span>
          <strong>Create → bind → resolve → revoke</strong>
        </div>
        <div>
          <span className="label">Private state</span>
          <strong>STRK20 on Starknet mainnet</strong>
        </div>
      </section>
    </main>
  );
}
