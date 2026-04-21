import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer } from 'recharts';

const mockRecords = [
  { type: 'order', id: 'ord_1001', amount: 41.6723, region: 'us-east-1' },
  { type: 'order', id: 'ord_1002', amount: 12.1104, region: 'eu-west-1' },
  { type: 'refund', id: 'ref_1003', amount: -5.4002, region: 'ap-south-1' },
];

function LeftColumn({ systemState, pulseData }) {
  const pulseColor = systemState === 'BROKEN' ? 'var(--red-alert)' : 'var(--green-pulse)';

  return (
    <section style={{ border: '1px solid #1a2332', borderRadius: '8px', padding: '20px' }}>
      <h2 style={{ marginTop: 0 }}>The Stream</h2>

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ marginTop: 0 }}>Streaming Pulse Graph</h3>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={pulseData}>
            <XAxis dataKey="time" stroke="var(--text-muted)" tickLine={false} axisLine={false} />
            <YAxis stroke="var(--text-muted)" tickLine={false} axisLine={false} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={pulseColor}
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
          className={systemState === 'BROKEN' ? 'record--broken' : ''}
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
          {mockRecords.map((record, index) => (
            <div key={`${record.id}-${index}`}>
              {JSON.stringify(record)}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default LeftColumn;
