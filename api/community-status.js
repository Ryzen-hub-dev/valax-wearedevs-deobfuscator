const net = require('net');

function isPrivateAddress(hostname) {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (net.isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:');
}

module.exports = async function handler(_request, response) {
  const configuredUrl = process.env.COMMUNITY_WORKER_STATUS_URL;
  if (!configuredUrl) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(503).json({
      error: 'WORKER_NOT_CONNECTED',
      message: 'The always-on Discord worker endpoint has not been connected yet.'
    });
  }

  let target;
  try {
    target = new URL(configuredUrl);
  } catch {
    return response.status(500).json({ error: 'INVALID_WORKER_URL' });
  }
  if (!['http:', 'https:'].includes(target.protocol) || isPrivateAddress(target.hostname)) {
    return response.status(500).json({ error: 'UNSAFE_WORKER_URL' });
  }

  target.pathname = '/api/community-status';
  target.search = '';
  try {
    const upstream = await fetch(target, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000)
    });
    if (!upstream.ok) throw new Error(`Worker returned HTTP ${upstream.status}`);
    const data = await upstream.json();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    return response.status(200).json(data);
  } catch (error) {
    response.setHeader('Cache-Control', 'no-store');
    return response.status(502).json({ error: 'WORKER_UNREACHABLE', message: error.message });
  }
};
