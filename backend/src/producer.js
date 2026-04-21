const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { kafka, bootstrapTopics } = require('./kafka-client');

const app = express();
app.use(cors());
app.use(express.json());

const port = process.env.PRODUCER_PORT || 3003;
const producer = kafka.producer();

// 2. The State & Chaos Hook
let currentSchemaVersion = 'v1';
let schemaIndex = 1;

app.post('/api/producer/chaos', (req, res) => {
    schemaIndex++;
    if (schemaIndex > 5) schemaIndex = 2;
    currentSchemaVersion = `v${schemaIndex}`;
    res.json({ status: "chaos_initiated", version: currentSchemaVersion });
});

app.post('/api/producer/reset', (req, res) => {
    currentSchemaVersion = 'v1';
    res.json({ status: "reset", version: "v1" });
});

// 3. The Streaming Loop
async function start() {
    try {
        await bootstrapTopics();
        await producer.connect();

        const intervalMs = process.env.PRODUCER_INTERVAL_MS || 500;

        setInterval(async () => {
            try {
                let payload;
                if (currentSchemaVersion === 'v1') {
                    payload = {
                        id: uuidv4(),
                        total_price: parseFloat((Math.random() * 100).toFixed(2))
                    };
                } else if (currentSchemaVersion === 'v2') {
                    payload = {
                        id: uuidv4(),
                        price: { amount: parseFloat((Math.random() * 100).toFixed(2)), currency: "USD" }
                    };
                } else if (currentSchemaVersion === 'v3') {
                    payload = {
                        orderId: uuidv4(),
                        totalAmount: parseFloat((Math.random() * 100).toFixed(2))
                    };
                } else if (currentSchemaVersion === 'v4') {
                    payload = {
                        identifier: uuidv4(),
                        cost: parseFloat((Math.random() * 100).toFixed(2))
                    };
                } else {
                    payload = {
                        txn_id: uuidv4(),
                        value: parseFloat((Math.random() * 100).toFixed(2))
                    };
                }

                await producer.send({
                    topic: 'orders.raw',
                    messages: [
                        { value: Buffer.from(JSON.stringify(payload)) }
                    ]
                });

                console.log(`[Producer] Sent ${currentSchemaVersion} payload`);
            } catch (err) {
                console.error('[Producer] Error sending message to Kafka:', err);
            }
        }, intervalMs);
    } catch (error) {
        console.error('[Producer] Failed to start:', error);
    }
}

// 4. Server Startup
app.listen(port, () => console.log('Producer Service A running on port', port));

start();
