require('dotenv/config');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const Ajv = require('ajv');
const { kafka } = require('./kafka-client.js');

const app = express();
const port = process.env.TRANSFORMER_PORT || 3002;

app.use(cors());
app.use(express.json());

const ajv = new Ajv();
const schema = JSON.parse(fs.readFileSync('./src/schemas/order-v1.json', 'utf8'));
const validateV1 = ajv.compile(schema);

let currentLogic = (data) => data;

app.post('/api/internal/update-logic', (req, res) => {
  try {
    const newFn = eval(`(${req.body.script})`);
    if (typeof newFn !== 'function') throw new Error('Eval did not produce a function');
    
    // Smoke Test against a v2 format
    const testResult = newFn({ id: 'test', price: { amount: 1.0, currency: 'USD' } });
    if (typeof testResult.total_price !== 'number') throw new Error('Function output failed smoke test');
    
    currentLogic = newFn; // Hot-Swap completed natively in memory
    res.json({ ok: true, version: `patch-${Date.now()}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: 'transformer-gate' });

async function start() {
  await producer.connect();
  await consumer.connect();
  
  await consumer.subscribe({ topic: 'orders.raw', fromBeginning: true });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const payload = JSON.parse(message.value.toString());
        const processed = currentLogic(payload);
        
        if (validateV1(processed)) {
          // Green State
          await producer.send({
            topic: 'orders.clean',
            messages: [{ value: JSON.stringify(processed) }]
          });
          
          try {
            await fetch('http://localhost:3001/api/internal/charge', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                agent: "Observation",
                cost: parseFloat(process.env.HEARTBEAT_COST || 0.0001),
                description: "Proof of Health"
              })
            });
          } catch (e) {
            console.error('Error hitting Hub to trigger charge:', e.message);
          }
        } else {
          // Red State
          await producer.send({
            topic: 'orders.dlq',
            messages: [{ value: JSON.stringify(processed) }]
          });
          
          try {
            await fetch('http://localhost:3001/api/internal/system-state', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ state: "BROKEN" })
            });
          } catch (e) {
            console.error('Error hitting Hub to update system state:', e.message);
          }
        }
      } catch (err) {
        console.error('Failed processing message:', err.message);
      }
    }
  });
}

start().catch(err => {
  console.error("Failed to start Kafka components in Service B:", err);
});

app.listen(port, () => console.log('Transformer Service B running on port', port));
