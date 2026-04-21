import { useEffect, useRef, useState } from 'react';
import './App.css';
import LeftColumn from './components/LeftColumn';
import RightColumn from './components/RightColumn';
import CenterColumn from './components/CenterColumn';

const MAX_LEDGER_ENTRIES = 25;

function App() {
  const [systemState, setSystemState] = useState("HEALTHY");
  const [ledger, setLedger] = useState([]);
  const [totalCost, setTotalCost] = useState(0);
  const [agents, setAgents] = useState({ discovery: "IDLE", fixer: "IDLE", verifier: "IDLE" });
  const [pulseData, setPulseData] = useState([]);
  const [recentRecords, setRecentRecords] = useState([]);
  const sawMetricsRef = useRef(false);

  useEffect(() => {
    const es = new EventSource('http://localhost:3001/api/stream');

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.type) {
          case 'ledger_entry':
            setLedger((prev) => [payload, ...prev].slice(0, MAX_LEDGER_ENTRIES));
            setTotalCost((prev) => prev + (payload.cost || 0));
            break;
          case 'system_state':
            setSystemState(payload.state);
            break;
          case 'agent_status':
            setAgents((prev) => ({ ...prev, [payload.agent]: payload.status }));
            break;
          case 'metrics':
            sawMetricsRef.current = true;
            setPulseData((prev) => {
              const newData = [...prev, { time: payload.time, value: Number(payload.value) || 0 }];
              return newData.slice(-20);
            });
            break;
          case 'heartbeat':
          case 'drift_detected':
            setRecentRecords((prev) => [payload, ...prev].slice(0, 10));
            if (!sawMetricsRef.current) {
              setPulseData((prev) => {
                const eventDate = payload.timestamp ? new Date(payload.timestamp) : new Date();
                const time = eventDate.toLocaleTimeString([], { hour12: false });
                const data = [...prev];
                const lastPoint = data[data.length - 1];

                if (lastPoint && lastPoint.time === time) {
                  data[data.length - 1] = { ...lastPoint, value: (Number(lastPoint.value) || 0) + 1 };
                } else {
                  data.push({ time, value: 1 });
                }

                return data.slice(-20);
              });
            }
            break;
          default:
            break;
        }
      } catch (err) {
        console.error('Failed to parse SSE message', err);
      }
    };

    return () => {
      es.close();
    };
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '20px', minHeight: '100vh' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', alignContent: 'start' }}>
        <LeftColumn systemState={systemState} pulseData={pulseData} recentRecords={recentRecords} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px', alignContent: 'start' }}>
        <CenterColumn agents={agents} systemState={systemState} />
        <RightColumn systemState={systemState} totalCost={totalCost} ledger={ledger} />
      </div>
    </div>
  );
}

export default App;
