const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');
const { ethers } = require('ethers');
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
let metrics = { processed: 0, errors: 0 };
const provider = new ethers.JsonRpcProvider(process.env.ARC_TESTNET_RPC);
const buyerWallet = new ethers.Wallet(process.env.NANOPAY_BUYER_PRIVATE_KEY);
const managedBuyerWallet = new ethers.NonceManager(buyerWallet.connect(provider));

const normalizeAddress = (address) => String(address || '').toLowerCase();

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
const recordCharge = (agent, cost, description, txHash = null) => {
  totalCost += cost;
  const transaction = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    agent,
    cost,
    description,
    txHash
  };
  ledger.push(transaction);

  broadcast({ 
    type: "ledger_entry", 
    agent, 
    cost, 
    description, 
    txHash,
    runningTotal: totalCost, 
    timestamp: transaction.timestamp 
  });
};

const executeAndRecordOnChainCharge = async (agent, cost, description) => {
  const sellerAddress = process.env.NANOPAY_SELLER_ADDRESS;
  if (!sellerAddress) {
    throw new Error('NANOPAY_SELLER_ADDRESS is required for on-chain charging');
  }

  const tx = await managedBuyerWallet.sendTransaction({
    to: sellerAddress,
    value: ethers.parseEther(String(cost))
  });

  recordCharge(agent, cost, description, tx.hash);
  return tx.hash;
};

// 4. The internal charging endpoint
app.post('/api/internal/charge', async (req, res) => {
  const txHashHeader = req.headers['x-402-txhash'];
  const txHash = Array.isArray(txHashHeader) ? txHashHeader[0] : txHashHeader;

  if (!txHash) {
    return res.status(402).json({
      status: 'error',
      message: 'Payment Required: missing x-402-txhash header'
    });
  }

  if (!ethers.isHexString(txHash, 32)) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: invalid x-402-txhash format'
    });
  }

  const expectedBuyerAddress = process.env.NANOPAY_BUYER_ADDRESS;
  const onChainTx = await provider.getTransaction(txHash).catch(() => null);

  if (
    expectedBuyerAddress &&
    onChainTx?.from &&
    normalizeAddress(onChainTx.from) !== normalizeAddress(expectedBuyerAddress)
  ) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized: tx sender is not approved buyer'
    });
  }

  const { agent, cost, description } = req.body;
  recordCharge(agent, cost, description, txHash);
  res.json({ status: 'success', txHash });
});

app.post('/api/internal/heartbeat', (req, res) => {
  const { record } = req.body;
  metrics.processed++;
  broadcast({ type: 'heartbeat', record, timestamp: new Date().toISOString() });
  res.json({ status: 'success' });
});

app.post('/api/internal/drift', (req, res) => {
  const { record, error } = req.body;
  metrics.errors++;
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

const recordManualInterventionAlert = async (reason) => {
  recordCharge(
    'ALERT',
    0,
    `Fixer patch failed verification. Manual intervention required. Reason: ${reason}`,
    null
  );
};

const runHealingFlow = async (badPayload) => {
  isHealing = true;
  systemState = 'HEALING';
  broadcast({ type: 'system_state', state: systemState });

  try {
    updateAgentStatus('discovery', 'ANALYZING');
    await executeAndRecordOnChainCharge(
      'Discovery',
      parseFloat(process.env.DISCOVERY_COST || 0.0010),
      'Analyzed DLQ schema drift'
    );
    await sleep(1500);
    updateAgentStatus('discovery', 'DONE');

    updateAgentStatus('fixer', 'PATCHING');

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

    // Calculate actual real-life token cost (GPT-4o-mini: $0.150/1M input, $0.600/1M output)
    let actualCost = parseFloat(process.env.FIXER_BOUNTY || 0.0050);
    let tokenDesc = 'Generated patch via OpenAI';
    if (response.usage) {
      const pTokens = response.usage.prompt_tokens || 0;
      const cTokens = response.usage.completion_tokens || 0;
      actualCost = parseFloat(((pTokens * 0.150 / 1000000) + (cTokens * 0.600 / 1000000)).toFixed(6));
      
      // Ensure the cost is at least non-zero for UI visibility
      actualCost = Math.max(actualCost, 0.0001); 
      tokenDesc = `OpenAI API usage: ${response.usage.total_tokens} tokens utilized`;
    }

    await executeAndRecordOnChainCharge('Fixer', actualCost, tokenDesc);

    const responseText = response.choices[0].message.content || '';
    let code = String(responseText)
      .trim()
      .replace(/^```(?:javascript|js)?\n?/, '')
      .replace(/\n?```$/, '');

    updateAgentStatus('fixer', 'DONE');

    updateAgentStatus('verifier', 'AUDITING');
    await executeAndRecordOnChainCharge(
      'Verifier',
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
      const verificationError = new Error(
        verifyBody.error || 'Transformer rejected generated patch'
      );
      verificationError.code = 'VERIFICATION_REJECTED';
      throw verificationError;
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

    if (error.code === 'VERIFICATION_REJECTED') {
      await recordManualInterventionAlert(error.message);
    }

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

app.post('/api/internal/reset-demo', async (req, res) => {
  try {
    lastKnownBadPayload = null;
    isHealing = false;
    pendingDlqCommit = null;

    const [producerResetRes, transformerResetRes] = await Promise.all([
      fetch('http://localhost:3003/api/producer/reset', { method: 'POST' }),
      fetch('http://localhost:3002/api/internal/reset-logic', { method: 'POST' })
    ]);

    if (!producerResetRes.ok) {
      throw new Error('Failed resetting producer schema version');
    }
    if (!transformerResetRes.ok) {
      throw new Error('Failed resetting transformer logic');
    }

    systemState = 'HEALTHY';
    updateAgentStatus('discovery', 'IDLE');
    updateAgentStatus('fixer', 'IDLE');
    updateAgentStatus('verifier', 'IDLE');
    broadcast({ type: 'system_state', state: systemState });

    return res.json({ status: 'success', state: systemState });
  } catch (error) {
    console.error('Failed to reset demo state:', error.message);
    return res.status(500).json({ status: 'error', message: error.message });
  }
});

setInterval(() => {
  const time = new Date().toLocaleTimeString([], { hour12: false });
  broadcast({ type: 'metrics', time, value: metrics.processed + metrics.errors });
  metrics = { processed: 0, errors: 0 };
}, 1000);

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
