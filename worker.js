export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const backendBase = env.BACKEND_URL || 'https://valax-wearedevs-deobfuscator-api.vercel.app';

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/') || url.pathname.startsWith('/health')) {
      try {
        const target = new URL(url.pathname + url.search, backendBase);
        const headers = new Headers(request.headers);
        headers.set('host', target.host);
        headers.set('x-forwarded-host', url.host);
        headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

        const proxyReq = new Request(target.toString(), {
          method: request.method,
          headers,
          body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : null,
          redirect: 'manual'
        });

        return await fetch(proxyReq);
      } catch (err) {
        return new Response(JSON.stringify({
          error: {
            code: 'GATEWAY_ERROR',
            message: `Failed to proxy request to backend: ${err.message}`
          }
        }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    if (env.ASSETS) {
      return await env.ASSETS.fetch(request);
    }

    return new Response(JSON.stringify({
      error: {
        code: 'NOT_FOUND',
        message: `Route '${url.pathname}' not found`
      }
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
