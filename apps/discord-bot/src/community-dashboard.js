const fs = require('fs');
const http = require('http');
const path = require('path');

function json(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(body);
}

class CommunityDashboard {
  constructor(client, config, store) {
    this.client = client;
    this.config = config;
    this.store = store;
    this.server = null;
    this.guild = null;
    this.startedAt = Date.now();
    this.pagePath = path.resolve(__dirname, '../../../public/community.html');
  }

  status() {
    const guild = this.guild;
    const store = this.store.snapshot();
    const online = guild
      ? guild.members.cache.filter(member => member.presence?.status && member.presence.status !== 'offline').size
      : 0;
    return {
      generatedAt: new Date().toISOString(),
      bot: {
        status: this.client.isReady() ? 'online' : 'starting',
        latencyMs: Math.max(0, Math.round(this.client.ws.ping || 0)),
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024)
      },
      community: {
        name: guild?.name || 'Valax',
        members: guild?.memberCount || 0,
        online,
        channels: guild?.channels.cache.size || 0,
        roles: guild?.roles.cache.size || 0,
        boosts: guild?.premiumSubscriptionCount || 0
      },
      operations: {
        openTickets: store.tickets.open,
        closedTickets: store.tickets.closed,
        pendingApplications: store.applications.pending,
        reviewedApplications: store.applications.reviewed,
        pendingLeaves: store.leaves.pending,
        economyUsers: store.economyUsers,
        dropsClaimed: store.dropsClaimed,
        creditedInvites: store.creditedInvites,
        countingCurrent: store.counting.current,
        countingHighScore: store.counting.highScore,
        systemErrors: store.systemErrors
      },
      activity: store.activity.map(item => ({
        type: item.type,
        text: item.text,
        createdAt: new Date(item.createdAt).toISOString()
      }))
    };
  }

  async start(guild) {
    if (!this.config.communityEnabled || !this.config.dashboardEnabled || this.server) return;
    this.guild = guild;
    this.server = http.createServer((request, response) => {
      const requestUrl = new URL(request.url, 'http://dashboard.local');
      if (request.method === 'GET' && ['/api/status', '/api/community-status'].includes(requestUrl.pathname)) {
        json(response, 200, this.status());
        return;
      }
      if (request.method === 'GET' && ['/', '/community.html'].includes(requestUrl.pathname)) {
        try {
          const page = fs.readFileSync(this.pagePath);
          response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': page.length,
            'Cache-Control': 'no-cache',
            'X-Content-Type-Options': 'nosniff'
          });
          response.end(page);
        } catch (error) {
          json(response, 500, { error: 'Dashboard page is unavailable.', detail: error.message });
        }
        return;
      }
      json(response, 404, { error: 'Not found' });
    });
    this.server.on('error', error => console.error(`Community dashboard error: ${error.message}`));
    await new Promise((resolve, reject) => {
      const onError = error => reject(error);
      this.server.once('error', onError);
      this.server.listen(this.config.dashboardPort, this.config.dashboardHost, () => {
        this.server.off('error', onError);
        resolve();
      });
    });
    console.log(`Valax control center listening on http://${this.config.dashboardHost}:${this.config.dashboardPort}.`);
  }

  stop() {
    if (this.server) this.server.close();
    this.server = null;
  }
}

module.exports = { CommunityDashboard };
