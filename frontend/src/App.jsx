import { useEffect, useState } from 'react';
import './App.css';
import LeftColumn from './components/LeftColumn';
import CenterColumn from './components/CenterColumn';
import RightColumn from './components/RightColumn';

const MAX_LEDGER_ENTRIES = 25;

function App() {
  const [systemState, setSystemState] = useState("HEALTHY");
  const [ledger, setLedger] = useState([]);
  const [totalCost, setTotalCost] = useState(0);
  const [agents, setAgents] = useState({ discovery: "IDLE", fixer: "IDLE", verifier: "IDLE" });
  const [pulseData, setPulseData] = useState([]);
  const [recentRecords, setRecentRecords] = useState([]);

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
            setPulseData((prev) => {
              const next = [...prev, { time: payload.time, value: payload.value }];
              if (next.length > 50) next.shift(); // Keep last 50 data points
              return next;
            });
            break;
          case 'heartbeat':
          case 'drift_detected':
            setRecentRecords((prev) => {
              const next = [payload, ...prev];
              if (next.length > 20) next.pop(); // Keep last 20 records
              return next;
            });
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
    <>
      <header>
        <h1>Arc Data Piper</h1>
        <p style={{ color: 'var(--text-muted)' }}>Self-Healing Data Pipeline Command Center</p>
      </header>
      <div className="app-container">
        <div className="app-column">
          <LeftColumn 
            systemState={systemState} 
            pulseData={pulseData} 
            recentRecords={recentRecords} 
          />
        </div>

        <div className="app-column">
          <CenterColumn 
            agents={agents} 
            systemState={systemState} 
          />
          <RightColumn 
            systemState={systemState} 
            totalCost={totalCost} 
            ledger={ledger} 
          />
        </div>
      </div>
    </>
  );
}

export default App;
