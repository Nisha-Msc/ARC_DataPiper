const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.HUB_PORT || 3001;

app.use(cors());
app.use(express.json());

// Global State Variables
let systemState = "HEALTHY"; 
let totalCost = 0;
const ledger = []; 
const agents = { discovery: "IDLE", fixer: "IDLE", verifier: "IDLE" };
const connectedClients = new Set();

// 2. The SSE Broadcaster
const broadcast = (eventObj) => {
  const dataString = `data: ${JSON.stringify(eventObj)}\n\n`;
  connectedClients.forEach(clientRes => {
    clientRes.write(dataString);
  });
};

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  connectedClients.add(res);

  req.on('close', () => {
    connectedClients.delete(res);
  });
});

// 3. The Financial Ledger Logic
const recordCharge = (agent, cost, description) => {
  totalCost += cost;
  const transaction = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    agent,
    cost,
    description
  };
  ledger.push(transaction);

  broadcast({ 
    type: "ledger_entry", 
    agent, 
    cost, 
    description, 
    runningTotal: totalCost, 
    timestamp: transaction.timestamp 
  });
};

// 4. The internal charging endpoint
app.post('/api/internal/charge', (req, res) => {
  const { agent, cost, description } = req.body;
  recordCharge(agent, cost, description);
  res.json({ status: "success" });
});

// 5. The Rehydration Hook
app.get('/api/state', (req, res) => {
  res.json({ systemState, totalCost, ledger, agents });
});

// 6. Generic State Endpoints
app.post('/api/internal/system-state', (req, res) => {
  const { state } = req.body;
  systemState = state;
  broadcast({ type: "system_state", state: systemState });
  res.json({ status: "success" });
});
app.listen(PORT, () => {
  console.log(`Hub Service (Service C) is running on port ${PORT}`);
});
