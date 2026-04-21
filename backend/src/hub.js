const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');
const { kafka } = require('./kafka-client.js');
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
let isHealing = false;
let lastKnownBadPayload = null;
let pendingDlqCommit = null;
let agentConsumerRef = null;

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

app.post('/api/internal/heartbeat', (req, res) => {
  const { record } = req.body;
  broadcast({ type: 'heartbeat', record, timestamp: new Date().toISOString() });
  res.json({ status: 'success' });
});

app.post('/api/internal/drift', (req, res) => {
  const { record, error } = req.body;
  broadcast({ type: 'drift_detected', record, error, timestamp: new Date().toISOString() });
  res.json({ status: 'success' });
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runReplayTask = async () => {
  console.log('Starting Replay Task...');
  const replayConsumer = kafka.consumer({ groupId: `dlq-replay-${Date.now()}` });

  try {
    await replayConsumer.connect();
    await replayConsumer.subscribe({ topic: 'orders.dlq', fromBeginning: true });
    await replayConsumer.run({
      eachMessage: async () => {
        // Drain messages during replay window to simulate recovery consumption.
      }
    });
    await sleep(3000);
  } finally {
    try {
      await replayConsumer.stop();
    } catch (error) {
      console.error('Replay consumer stop failed:', error.message);
    }
    await replayConsumer.disconnect();
  }
};

const updateAgentStatus = (agent, status) => {
  agents[agent] = status;
  broadcast({ type: 'agent_status', agent, status });
};

const runHealingFlow = async (badPayload) => {
  isHealing = true;
  systemState = 'HEALING';
  broadcast({ type: 'system_state', state: systemState });

  try {
    updateAgentStatus('discovery', 'ANALYZING');
    recordCharge(
      'Discovery',
      parseFloat(process.env.DISCOVERY_COST || 0.0010),
      'Analyzed DLQ schema drift'
    );
    await sleep(1500);
    updateAgentStatus('discovery', 'DONE');

    updateAgentStatus('fixer', 'PATCHING');
    recordCharge(
      'Fixer',
      parseFloat(process.env.FIXER_BOUNTY || 0.0050),
      'Generated mapping patch via Gemini 2.5 Flash'
    );

    const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    console.log('[Fixer] Using baseURL:', baseURL);
    console.log('[Fixer] Using model:', process.env.OPENAI_MODEL || 'gpt-4o-mini');
    
    const openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: baseURL
    });
    const prompt =
      "You are a data pipeline repair agent. Generate a single synchronous JavaScript arrow function (data) => { ... } that transforms the ACTUAL schema into the EXPECTED schema. return ONLY the raw function string. No imports, no require, no async, no markdown fences. \nEXPECTED: { id: 'string', total_price: 'number' }\nACTUAL: " +
      badPayload;

    console.log('[Fixer] Sending prompt to LLM...');
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }]
    });
    console.log('[Fixer] Got response from LLM');

    const responseText = response.choices[0].message.content || '';
    let code = String(responseText)
      .trim()
      .replace(/^```(?:javascript|js)?\n?/, '')
      .replace(/\n?```$/, '');

    updateAgentStatus('fixer', 'DONE');

    updateAgentStatus('verifier', 'AUDITING');
    recordCharge(
      'Verification',
      parseFloat(process.env.VERIFICATION_COST || 0.0005),
      'Smoke tested JavaScript AST'
    );

    const verifyRes = await fetch('http://localhost:3002/api/internal/update-logic', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: code })
    });

    const verifyBody = await verifyRes.json().catch(() => ({}));
    if (!verifyRes.ok || !verifyBody.ok) {
      throw new Error('Transformer rejected generated patch');
    }

    updateAgentStatus('verifier', 'DONE');

    await runReplayTask();

    if (agentConsumerRef && pendingDlqCommit) {
      await agentConsumerRef.commitOffsets([pendingDlqCommit]);
      pendingDlqCommit = null;
    }
    lastKnownBadPayload = null;

    systemState = 'HEALTHY';
    broadcast({ type: 'system_state', state: systemState });
    await fetch(`http://localhost:${PORT}/api/internal/system-state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'HEALTHY' })
    }).catch(() => undefined);
  } catch (error) {
    console.error('Agent healing flow failed:', error.message);
    console.error('Full error:', error);
    systemState = 'DEGRADED';
    broadcast({ type: 'system_state', state: systemState });
    throw error;
  } finally {
    isHealing = false;
    // Always reset agent statuses so UI never gets permanently stuck
    updateAgentStatus('discovery', 'IDLE');
    updateAgentStatus('fixer', 'IDLE');
    updateAgentStatus('verifier', 'IDLE');
  }
};

app.post('/api/internal/authorize-fix', async (req, res) => {
  if (!lastKnownBadPayload || isHealing) {
    return res.status(400).json({
      status: 'error',
      message: 'No pending broken payload or repair already in progress'
    });
  }

  try {
    await runHealingFlow(lastKnownBadPayload);
    return res.json({ status: 'success' });
  } catch (error) {
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

const startHub = async () => {
  agentConsumerRef = kafka.consumer({ groupId: 'hub-agent' });
  await agentConsumerRef.connect();
  await agentConsumerRef.subscribe({ topic: 'orders.dlq', fromBeginning: true });

  await agentConsumerRef.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      lastKnownBadPayload = (message.value || Buffer.from('')).toString();
      pendingDlqCommit = {
        topic,
        partition,
        offset: (BigInt(message.offset) + 1n).toString()
      };

      if (systemState !== 'BROKEN' && !isHealing) {
        systemState = 'BROKEN';
        broadcast({ type: 'system_state', state: 'BROKEN' });
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`Hub Service (Service C) is running on port ${PORT}`);
  });
};

startHub().catch((error) => {
  console.error('Failed to start hub service:', error);
  process.exit(1);
});
