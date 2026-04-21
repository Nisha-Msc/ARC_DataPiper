import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';

function LeftColumn({ systemState, pulseData, recentRecords }) {
  const pulseColor = systemState === 'BROKEN' ? 'var(--red-alert)' : 'var(--green-pulse)';

  return (
    <section style={{ border: '1px solid #1a2332', borderRadius: '8px', padding: '20px' }}>
      <h2 style={{ marginTop: 0 }}>The Stream</h2>

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0 }}>Streaming Pulse Graph</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={pulseData}>
            <XAxis dataKey="time" stroke="var(--text-muted)" tickLine={false} axisLine={false} />
            <YAxis domain={[0, (dataMax) => Math.max(2, dataMax + 1)]} stroke="var(--text-muted)" tickLine={false} axisLine={false} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={pulseColor}
              strokeWidth={2}
              fill={pulseColor}
              fillOpacity={0.18}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 style={{ marginTop: 0 }}>Waterfall</h3>
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid #1a2332',
            borderRadius: '8px',
            padding: '12px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.82rem',
            lineHeight: 1.55,
            minHeight: '140px',
          }}
        >
          {recentRecords.map((r, i) => {
            const isDrift = r.type === 'drift_detected';
            const timeStr = r.timestamp ? r.timestamp.split('T')[1].split('.')[0] : '';
            return (
              <div key={i} style={{ color: isDrift ? 'var(--red-alert)' : 'var(--green-pulse)', padding: '3px 0', borderBottom: '1px solid #1a2332' }}>
                <span style={{ opacity: 0.5, marginRight: '8px' }}>[{timeStr}]</span>
                <strong>{isDrift ? '❌ DRIFT:' : '✅ OK:'}</strong> {JSON.stringify(r.record)}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default LeftColumn;
