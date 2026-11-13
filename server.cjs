// Local server entry point: `npm run server`.
// On Netlify the same app runs through netlify/functions/api.cjs instead.
const app = require('./server/app.cjs');
const { config, missingConfig } = require('./server/config.cjs');

app.listen(config.port, () => {
  console.log('====================================================');
  console.log(' WhatsApp Business Cloud API Hub is running');
  console.log(` Server URL : http://localhost:${config.port}`);
  console.log(` Webhook URL: http://localhost:${config.port}/webhook`);
  const missing = missingConfig();
  if (missing.length) console.warn(` Missing env vars: ${missing.join(', ')}`);
  console.log('====================================================');
});
