const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config/env');
const healthRoutes = require('./routes/health.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: config.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

app.use('/health', healthRoutes);

module.exports = app;
