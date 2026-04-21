import { useEffect, useState } from 'react';
import './App.css';
import LeftColumn from './components/LeftColumn';
import RightColumn from './components/RightColumn';
import CenterColumn from './components/CenterColumn';

function App() {
  const [systemState, setSystemState] = useState("HEALTHY");
  const [ledger, setLedger] = useState([]);
  const [totalCost, setTotalCost] = useState(0);
  const [agents, setAgents] = useState({ discovery: "IDLE", fixer: "IDLE", verifier: "IDLE" });
  const [pulseData, setPulseData] = useState([]);

  useEffect(() => {
    const es = new EventSource('http://localhost:3001/api/stream');

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        switch (payload.type) {
          case 'ledger_entry':
            setLedger((prev) => [...prev, payload]);
            setTotalCost((prev) => prev + (payload.cost || 0));
            break;
          case 'system_state':
            setSystemState(payload.state);
            break;
          case 'agent_status':
            setAgents((prev) => ({ ...prev, [payload.agent]: payload.status }));
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
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 400px minmax(300px, 1fr)', gap: '20px', height: '100vh' }}>
      <LeftColumn systemState={systemState} pulseData={pulseData} />

      <CenterColumn agents={agents} systemState={systemState} />
      <RightColumn systemState={systemState} totalCost={totalCost} ledger={ledger} />
    </div>
  );
}

export default App;
