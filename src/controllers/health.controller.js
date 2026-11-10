const { getDatabaseStatus } = require('../config/database');

function getHealth(req, res) {
  const database = getDatabaseStatus();
  const statusCode = database.isConnected ? 200 : 503;

  res.status(statusCode).json({
    success: database.isConnected,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      database,
    },
  });
}

module.exports = { getHealth };
