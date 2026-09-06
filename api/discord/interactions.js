const { verifyDiscordSignature } = require('../../packages/discord/src/interactions/verify');
const { formatRecoveryResponse } = require('../../packages/discord/src/responses/messages');
const { recover } = require('../../packages/core/src');

/**
 * Serverless HTTP interaction endpoint for Discord.
 * Handles PING/PONG and /valax-recover without requiring an always-on Gateway connection.
 */
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const publicKey = process.env.DISCORD_PUBLIC_KEY;

  // Read raw body
  let rawBody = '';
  if (typeof req.body === 'string') {
    rawBody = req.body;
  } else if (Buffer.isBuffer(req.body)) {
    rawBody = req.body.toString('utf8');
  } else if (req.rawBody) {
    rawBody = req.rawBody;
  } else {
    rawBody = JSON.stringify(req.body);
  }

  // Validate signature if public key is configured
  if (publicKey) {
    const isValid = verifyDiscordSignature(rawBody, signature, timestamp, publicKey);
    if (!isValid) {
      return res.status(401).send('Invalid request signature');
    }
  }

  const body = typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : JSON.parse(rawBody);

  // Type 1: PING -> return PONG
  if (body.type === 1) {
    return res.status(200).json({ type: 1 });
  }

  // Type 2: APPLICATION_COMMAND
  if (body.type === 2) {
    const commandName = body.data?.name;
    if (commandName === 'valax-recover') {
      const options = body.data.options || [];
      const stageOption = options.find(o => o.name === 'stage');
      const stage = stageOption ? stageOption.value : 'L5';

      // Immediate acknowledgment (deferred response)
      return res.status(200).json({
        type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
        data: {
          content: '🔄 Processing Lua/Luau source with Valax Source Recovery engine...'
        }
      });
    }
  }

  return res.status(400).json({ error: 'Unknown interaction type' });
};
