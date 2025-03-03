const assert = require('assert');
const { WebSocketServer } = require('ws');
const {createServer} = require('http');
const {createEndpoint} = require('@jambonz/node-client-ws');
const server = createServer();
const logger = require('./lib/utils/logger');
const yardmaster = require('./lib/utils/yardmaster');
const port = process.env.WS_PORT || 3000;
const wssStream = new WebSocketServer({ noServer: true });
const makeService = createEndpoint({
  server,
  externalWss: [
    {
      path: '/audio-stream',
      wss: wssStream
    }
  ]});

// eslint-disable-next-line max-len
assert.ok(process.env.OPENAI_API_KEY || process.env.ULTRAVOX_API_KEY, 'OPENAI_API_KEY  or ULTRAVOX_API_KEY is required');
assert.ok(process.env.CALLED_PARTY_LANGUAGE, 'CALLED_PARTY_LANGUAGE is required');
assert.ok(process.env.CALLING_PARTY_LANGUAGE, 'CALLING_PARTY_LANGUAGE is required');

require('./lib/routes')({logger, makeService});

server.listen(port, () => {
  logger.info(`jambonz websocket server listening at http://localhost:${port}`);
});

// handle connections from jambonz listen socket
wssStream.on('connection', (ws) => {

  const messageHandler = async(message, isBinary) => {
    if (!isBinary) {
      try {
        const {callSid, parentCallSid} = JSON.parse(message.toString());
        // Remove this handler before passing to yardmaster
        ws.removeListener('message', messageHandler);
        // Hand off to yardmaster
        yardmaster.addJambonzWebsocket(ws, callSid, parentCallSid);
      } catch (err) {
        logger.error({ err, message: message.toString() }, 'Invalid JSON received');
        ws.close(1003, 'Invalid setup data');
      }
    }
    // Silently ignore binary messages until we get our text frame
  };
  ws.on('message', messageHandler);

  // Add a timeout to close connections that don't send setup info
  const timeout = setTimeout(() => {
    // If we still have our message handler attached, the connection
    // never completed setup
    if (ws.listenerCount('message') > 0 && ws.listeners('message').includes(messageHandler)) {
      logger.warn('Closing WebSocket connection due to setup timeout');
      ws.removeListener('message', messageHandler);
      ws.close(1000, 'Setup timeout');
    }
  }, 10000); // 10 second timeout

  // Clear the timeout if the connection closes before setup
  ws.once('close', () => {
    clearTimeout(timeout);
  });
});
