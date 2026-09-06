const crypto = require('crypto');

/**
 * Validates a Discord interaction request signature using Node.js standard crypto.
 * @param {string} rawBody UTF-8 request body string
 * @param {string} signature Hex-encoded signature from X-Signature-Ed25519
 * @param {string} timestamp Timestamp from X-Signature-Timestamp
 * @param {string} clientPublicKey Hex-encoded public key from Discord application settings
 * @returns {boolean}
 */
function verifyDiscordSignature(rawBody, signature, timestamp, clientPublicKey) {
  if (!rawBody || !signature || !timestamp || !clientPublicKey) {
    return false;
  }

  try {
    const rawKey = Buffer.from(clientPublicKey, 'hex');
    const sig = Buffer.from(signature, 'hex');
    const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), Buffer.from(rawBody, 'utf8')]);

    // Construct SPKI DER for Ed25519:
    // 302a300506032b6570032100 + 32-byte public key
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const spkiKey = Buffer.concat([spkiPrefix, rawKey]);

    const publicKey = crypto.createPublicKey({
      key: spkiKey,
      format: 'der',
      type: 'spki'
    });

    return crypto.verify(null, message, publicKey, sig);
  } catch (err) {
    return false;
  }
}

module.exports = { verifyDiscordSignature };
