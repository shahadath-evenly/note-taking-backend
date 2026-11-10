const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const config = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: config.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.bodyLimit }));

app.use('/health', healthRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
