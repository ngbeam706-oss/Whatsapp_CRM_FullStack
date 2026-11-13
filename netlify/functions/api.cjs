const serverless = require('serverless-http');
const app = require('../../server/app.cjs');

const handler = serverless(app);

exports.handler = async (event, context) => {
  const result = await handler(event, context);
  return result;
};
