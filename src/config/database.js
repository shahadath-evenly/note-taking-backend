const mongoose = require('mongoose');

mongoose.connection.on('connected', () => {
  console.log('MongoDB connection established');
});

mongoose.connection.on('error', (error) => {
  console.error(`MongoDB connection error: ${error.message}`);
});

mongoose.connection.on('disconnected', () => {
  console.log('MongoDB connection disconnected');
});

async function connectDB(mongoUri) {
  await mongoose.connect(mongoUri);
  return mongoose.connection;
}

async function disconnectDB() {
  await mongoose.disconnect();
}

const READY_STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;
  return {
    state: READY_STATE_LABELS[readyState] || 'unknown',
    isConnected: readyState === 1,
  };
}

module.exports = {
  connectDB,
  disconnectDB,
  getDatabaseStatus,
};
