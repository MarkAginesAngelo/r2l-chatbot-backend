const app = require('./app');
const env = require('./config/env');

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] R2L Chatbot API listening on http://localhost:${env.port}`);
  // eslint-disable-next-line no-console
  console.log(`[server] Environment: ${env.nodeEnv}`);
});
