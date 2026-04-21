require('dotenv/config');
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'arc-piper',
  brokers: [(process.env.KAFKA_BROKERS || 'localhost:19092')]
});

const bootstrapTopics = async () => {
  const admin = kafka.admin();
  await admin.connect();
  
  await admin.createTopics({
    topics: [
      { topic: 'orders.raw', numPartitions: 1 },
      { topic: 'orders.clean', numPartitions: 1 },
      { topic: 'orders.dlq', numPartitions: 1 }
    ]
  });

  console.log('Successfully initialized Kafka topics: orders.raw, orders.clean, orders.dlq');
  
  await admin.disconnect();
};

module.exports = { kafka, bootstrapTopics };
