function RightColumn({ systemState, totalCost, ledger }) {
  const totalizerColor = systemState === 'BROKEN' ? 'var(--red-alert)' : 'var(--green-pulse)';

  return (
    <section style={{ border: '1px solid #1a2332', borderRadius: '8px', padding: '20px' }}>
      <h2 style={{ marginTop: 0 }}>The Economy</h2>

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0 }}>Live Totalizer</h3>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '3rem',
            fontWeight: 800,
            color: totalizerColor,
            letterSpacing: '0.03em',
          }}
        >
          ${totalCost.toFixed(4)}
        </div>
      </div>

      <div>
        <h3 style={{ marginTop: 0 }}>Transaction Feed</h3>
        <div
          style={{
            display: 'grid',
            gap: '8px',
            maxHeight: 'calc(100vh - 520px)',
            overflow: 'hidden',
          }}
        >
          {ledger.map((tx, i) => (
            <div
              key={`${tx.agent}-${i}-${tx.description}`}
              style={{
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)',
                fontSize: '0.88rem',
                borderBottom: '1px dashed #1f2a3d',
                paddingBottom: '6px',
              }}
            >
              [{tx.agent}: ${tx.cost.toFixed(4)}] - {tx.description}
            </div>
          ))}
          {ledger.length === 0 && (
            <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              Waiting for transactions...
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default RightColumn;
