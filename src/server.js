const http = require('http');
const app = require('./app');
const env = require('./config/env');
const { initSocket } = require('./config/socket');
const logger = require('./config/logger');

const server = http.createServer(app);
initSocket(server);

server.listen(env.port, () => {
  logger.info(`R2L Chatbot API listening on http://localhost:${env.port}`);
  logger.info('Socket.io ready for staff dashboard real-time events');
  logger.info(`Environment: ${env.nodeEnv}`);
});
