/**
 * Web Frontend Server for Valax Source Recovery.
 * Communicates strictly via HTTP with Product API.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PUBLIC_DIR = path.resolve(__dirname, '../public');

class WebServer {
  /**
   * @param {object} [options]
   * @param {number} [options.port=8080]
   * @param {number} [options.apiPort=3000]
   */
  constructor(options = {}) {
    this.port = options.port || parseInt(process.env.WEB_PORT || '8080', 10);
    this.apiPort = options.apiPort || parseInt(process.env.PORT || '3000', 10);
    this.server = http.createServer(this._handleRequest.bind(this));
  }

  listen(port, cb) {
    const p = port || this.port;
    return this.server.listen(p, cb);
  }

  close(cb) {
    return this.server.close(cb);
  }

  _handleRequest(req, res) {
    const parsed = url.parse(req.url);
    const pathname = parsed.pathname;

    // 1. Proxy API & Health requests to Product API server
    if (pathname.startsWith('/api/') || pathname.startsWith('/health/')) {
      return this._proxyToApi(req, res);
    }

    // 2. Static Web Routes
    if (pathname === '/' || pathname === '/index.html') {
      return this._serveFile(res, path.join(PUBLIC_DIR, 'index.html'), 'text/html');
    }
    if (pathname === '/dashboard') {
      return this._serveFile(res, path.join(PUBLIC_DIR, 'dashboard.html'), 'text/html');
    }
    if (pathname === '/recover') {
      return this._serveFile(res, path.join(PUBLIC_DIR, 'recover.html'), 'text/html');
    }
    if (pathname.startsWith('/jobs/')) {
      return this._serveFile(res, path.join(PUBLIC_DIR, 'job.html'), 'text/html');
    }
    if (pathname === '/app.css') {
      return this._serveFile(res, path.join(PUBLIC_DIR, 'app.css'), 'text/css');
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  _serveFile(res, filePath, contentType) {
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File Not Found');
    }
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': contentType + '; charset=utf-8',
      'Content-Length': content.length,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  }

  _proxyToApi(req, res) {
    const options = {
      hostname: '127.0.0.1',
      port: this.apiPort,
      path: req.url,
      method: req.method,
      headers: req.headers
    };

    const proxyReq = http.request(options, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', err => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: {
          code: 'BAD_GATEWAY',
          message: `Product API unreachable: ${err.message}`
        }
      }));
    });

    req.pipe(proxyReq);
  }
}

if (require.main === module) {
  const server = new WebServer();
  server.listen(undefined, () => {
    console.log(`Valax Web Interface running on http://localhost:${server.port}`);
  });
}

module.exports = { WebServer };
