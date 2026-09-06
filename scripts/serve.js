const http = require('http');
const fs = require('fs');
const path = require('path');
const recoveryHandler = require('../api/recovery');
const healthHandler = require('../api/health');
const discordHandler = require('../api/discord/interactions');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // Helper to read JSON body
  const readBody = () => new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve(data);
      }
    });
  });

  // Mock response object for Vercel handlers
  const mockRes = {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(data) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
      return this;
    },
    send(text) {
      res.end(text);
      return this;
    },
    setHeader(...args) {
      res.setHeader(...args);
      return this;
    }
  };

  if (url.pathname === '/api/recovery') {
    req.body = await readBody();
    return recoveryHandler(req, mockRes);
  }

  if (url.pathname === '/api/health') {
    return healthHandler(req, mockRes);
  }

  if (url.pathname === '/api/discord/interactions') {
    req.body = await readBody();
    return discordHandler(req, mockRes);
  }

  // Static files in public/
  let filePath = path.join(__dirname, '../public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, '../public', 'index.html');
  }

  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json'
  };

  res.setHeader('Content-Type', mimeTypes[ext] || 'text/plain');
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Valax Source Recovery server running at http://localhost:${PORT}`);
});
