const ACTIVE_AGENT_STATUSES = new Set(['ANALYZING', 'PATCHING', 'AUDITING']);

function CenterColumn({ agents, systemState }) {
  const triggerSchemaDrift = async () => {
    try {
      await fetch('http://localhost:3003/api/producer/chaos', { method: 'POST' });
    } catch (error) {
      console.error('Failed to trigger chaos event', error);
    }
  };

  const cards = [
    { key: 'discovery', title: '🕵️ Discovery Agent' },
    { key: 'fixer', title: '🛠️ Fixer Agent' },
    { key: 'verifier', title: '🛡️ Verification Agent' },
  ];

  return (
    <section style={{ border: '1px solid #1a2332', borderRadius: '8px', padding: '20px' }}>
      <h2 style={{ marginTop: 0, textAlign: 'center' }}>Auto-Recovery Center</h2>
      <p style={{ marginTop: 0, marginBottom: '16px', color: 'var(--text-muted)', textAlign: 'center' }}>
        System State: {systemState}
      </p>

      <button
        onClick={triggerSchemaDrift}
        style={{
          width: '100%',
          border: 'none',
          borderRadius: '10px',
          padding: '18px 16px',
          fontSize: '1.05rem',
          fontWeight: 800,
          letterSpacing: '0.01em',
          background: 'var(--red-alert)',
          color: '#ffffff',
          cursor: 'pointer',
          marginBottom: '18px',
        }}
      >
        Simulate Upstream API Update
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
        {cards.map((card) => {
          const status = agents[card.key];
          const isActive = ACTIVE_AGENT_STATUSES.has(status);

          return (
            <article
              key={card.key}
              style={{
                border: '1px solid #1f2a3d',
                borderRadius: '10px',
                padding: '14px',
                background: 'var(--bg-card)',
                color: isActive ? 'var(--blue-agent)' : 'var(--text-muted)',
                boxShadow: isActive ? '0 0 20px rgba(56, 189, 248, 0.45)' : 'none',
                transition: 'box-shadow 180ms ease, color 180ms ease',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '6px' }}>{card.title}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>Status: {status}</div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default CenterColumn;
