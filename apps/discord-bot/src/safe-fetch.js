const dns = require('dns').promises;
const net = require('net');

const MAX_REDIRECTS = 3;

function isPrivateIp(address) {
  if (!address) return true;

  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224;
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb') ||
      normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
      normalized.startsWith('::ffff:192.168.') || normalized.startsWith('::ffff:169.254.');
  }

  return true;
}

async function validatePublicHttpsUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('The link is not a valid URL.');
  }

  if (url.protocol !== 'https:') throw new Error('Only HTTPS links are accepted.');
  if (url.username || url.password) throw new Error('Links containing credentials are not accepted.');
  if (url.port && url.port !== '443') throw new Error('Only the standard HTTPS port is accepted.');
  if (url.hostname.toLowerCase() === 'localhost') throw new Error('Local links are not accepted.');

  if (net.isIP(url.hostname) && isPrivateIp(url.hostname)) {
    throw new Error('Private or local network links are not accepted.');
  }

  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('The link resolves to a private or unavailable network address.');
  }

  return url;
}

async function readBoundedResponse(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (declaredLength > maxBytes) throw new Error(`The source is larger than ${maxBytes} bytes.`);

  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`The source is larger than ${maxBytes} bytes.`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

async function fetchSource(rawUrl, maxBytes, redirectCount = 0) {
  if (redirectCount > MAX_REDIRECTS) throw new Error('The link redirected too many times.');
  const url = await validatePublicHttpsUrl(rawUrl);
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    headers: { 'User-Agent': 'Valax-Discord-Bot/1.0' }
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error('The source link returned an invalid redirect.');
    return fetchSource(new URL(location, url).toString(), maxBytes, redirectCount + 1);
  }

  if (!response.ok) throw new Error(`The source link returned HTTP ${response.status}.`);
  const buffer = await readBoundedResponse(response, maxBytes);
  const filename = decodeURIComponent(url.pathname.split('/').pop() || 'script.lua').slice(0, 100);
  return { source: buffer.toString('utf8'), filename };
}

module.exports = { fetchSource, isPrivateIp, readBoundedResponse, validatePublicHttpsUrl };
