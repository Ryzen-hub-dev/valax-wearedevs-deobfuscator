export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.BACKEND_URL && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/"))) {
      const target = new URL(url.pathname + url.search, env.BACKEND_URL);
      return fetch(target.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body,
        redirect: "manual"
      });
    }
    return new Response("Not Found", { status: 404 });
  }
};
