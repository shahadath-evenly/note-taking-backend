const app = require('./app');
const config = require('./config/env');
const { connectDB, disconnectDB } = require('./config/database');

const SHUTDOWN_TIMEOUT_MS = 10000;

let httpServer;
let isShuttingDown = false;

async function start() {
  try {
    await connectDB(config.mongoUri);
  } catch (error) {
    console.error(`Failed to connect to MongoDB: ${error.message}`);
    process.exit(1);
    return;
  }

  httpServer = app.listen(config.port, () => {
    console.log(`Backend server listening on port ${config.port} (${config.nodeEnv})`);
  });
}

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  console.log(`Received ${signal}, shutting down gracefully...`);

  const forceExitTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDB();
    clearTimeout(forceExitTimer);
    console.log('Shutdown complete');
    process.exit(0);
  } catch (error) {
    clearTimeout(forceExitTimer);
    console.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start();
