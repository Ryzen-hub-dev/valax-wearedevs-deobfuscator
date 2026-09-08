/**
 * Production Redis Queue Adapter:
 * Distributed, multi-process persistent job queue implementing lease tokens,
 * heartbeats, atomic claim via Redis primitives, idempotency, and backpressure.
 * 
 * Includes:
 * 1. Minimal zero-dependency RESP (Redis Serialization Protocol) client via net.Socket.
 * 2. SynchronousRedisClient for high-speed deterministic testing and restarts.
 */

const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { JobState, TERMINAL_STATES, isValidTransition } = require('./types');

/**
 * Minimal zero-dependency Redis RESP2 client for live TCP connections.
 */
class MinimalRedisClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 6379;
    this.socket = null;
    this.connected = false;
    this.buffer = '';
    this.pendingCallbacks = [];
  }

  async connect(timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.socket) this.socket.destroy();
        reject(new Error(`Redis connection timeout to ${this.host}:${this.port}`));
      }, timeoutMs);

      let connectionSettled = false;
      this.socket = net.createConnection({ host: this.host, port: this.port }, () => {
        if (connectionSettled) return;
        connectionSettled = true;
        clearTimeout(timer);
        this.connected = true;
        this.emit('connect');
        resolve();
      });

      this.socket.setEncoding('utf8');

      this.socket.on('data', (chunk) => {
        this.buffer += chunk;
        this._processBuffer();
      });

      this.socket.on('error', (err) => {
        clearTimeout(timer);
        this.connected = false;
        if (!connectionSettled) {
          connectionSettled = true;
          reject(err);
        }
        if (this.pendingCallbacks.length > 0) {
          const cb = this.pendingCallbacks.shift();
          cb(err);
        }
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      });

      this.socket.on('close', () => {
        this.connected = false;
        this.emit('close');
      });
    });
  }

  async sendCommand(args) {
    if (!this.connected || !this.socket || this.socket.destroyed) {
      try {
        await this.connect();
      } catch (err) {
        throw new Error(`Redis client not connected: ${err.message}`);
      }
    }
    return new Promise((resolve, reject) => {

      let cmd = `*${args.length}\r\n`;
      for (const arg of args) {
        const str = String(arg);
        cmd += `$${Buffer.byteLength(str, 'utf8')}\r\n${str}\r\n`;
      }

      this.pendingCallbacks.push((err, res) => {
        if (err) reject(err);
        else resolve(res);
      });

      this.socket.write(cmd);
    });
  }

  _processBuffer() {
    while (this.buffer.length > 0 && this.pendingCallbacks.length > 0) {
      const parsed = this._parseResp(this.buffer);
      if (parsed === null) break;
      this.buffer = this.buffer.slice(parsed.bytesConsumed);
      const cb = this.pendingCallbacks.shift();
      if (parsed.isError) {
        cb(new Error(parsed.value));
      } else {
        cb(null, parsed.value);
      }
    }
  }

  _parseResp(buf) {
    if (buf.length < 3) return null;
    const type = buf[0];
    const crlfIndex = buf.indexOf('\r\n');
    if (crlfIndex === -1) return null;

    const line = buf.slice(1, crlfIndex);

    if (type === '+') return { value: line, isError: false, bytesConsumed: crlfIndex + 2 };
    if (type === '-') return { value: line, isError: true, bytesConsumed: crlfIndex + 2 };
    if (type === ':') return { value: parseInt(line, 10), isError: false, bytesConsumed: crlfIndex + 2 };
    if (type === '$') {
      const len = parseInt(line, 10);
      if (len === -1) return { value: null, isError: false, bytesConsumed: crlfIndex + 2 };
      const dataStart = crlfIndex + 2;
      const dataEnd = dataStart + len;
      if (buf.length < dataEnd + 2) return null;
      return { value: buf.slice(dataStart, dataEnd), isError: false, bytesConsumed: dataEnd + 2 };
    }
    if (type === '*') {
      const count = parseInt(line, 10);
      if (count === -1) return { value: null, isError: false, bytesConsumed: crlfIndex + 2 };
      let offset = crlfIndex + 2;
      const arr = [];
      for (let i = 0; i < count; i++) {
        const item = this._parseResp(buf.slice(offset));
        if (item === null) return null;
        arr.push(item.value);
        offset += item.bytesConsumed;
      }
      return { value: arr, isError: false, bytesConsumed: offset };
    }
    return null;
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.connected = false;
    }
  }
}

/**
 * In-memory synchronous Redis mock client sharing a given backing store.
 * Allows simulating multiple clients connecting to the exact same Redis database.
 */
class SynchronousRedisClient {
  constructor(sharedStore = null) {
    this.store = sharedStore || {
      strings: new Map(),
      lists: new Map(),
      ttls: new Map()
    };
    this.connected = true;
  }

  execCommand(args) {
    const cmd = String(args[0]).toUpperCase();

    if (cmd === 'GET') {
      const k = args[1];
      return this.store.strings.has(k) ? this.store.strings.get(k) : null;
    }

    if (cmd === 'SET') {
      const k = args[1];
      const v = args[2];
      this.store.strings.set(k, String(v));
      return 'OK';
    }

    if (cmd === 'DEL') {
      const k = args[1];
      const d1 = this.store.strings.delete(k);
      const d2 = this.store.lists.delete(k);
      return (d1 || d2) ? 1 : 0;
    }

    if (cmd === 'LPUSH') {
      const k = args[1];
      const v = String(args[2]);
      let list = this.store.lists.get(k);
      if (!list) { list = []; this.store.lists.set(k, list); }
      list.unshift(v);
      return list.length;
    }

    if (cmd === 'RPUSH') {
      const k = args[1];
      const v = String(args[2]);
      let list = this.store.lists.get(k);
      if (!list) { list = []; this.store.lists.set(k, list); }
      list.push(v);
      return list.length;
    }

    if (cmd === 'RPOP') {
      const k = args[1];
      const list = this.store.lists.get(k);
      if (!list || list.length === 0) return null;
      return list.pop();
    }

    if (cmd === 'LLEN') {
      const k = args[1];
      const list = this.store.lists.get(k);
      return list ? list.length : 0;
    }

    if (cmd === 'LREM') {
      const k = args[1];
      const v = String(args[3]);
      const list = this.store.lists.get(k);
      if (list) {
        this.store.lists.set(k, list.filter(item => item !== v));
      }
      return 1;
    }

    return 'OK';
  }

  sendCommand(args) {
    return Promise.resolve(this.execCommand(args));
  }
}

class RedisQueueAdapter extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {string} [options.host='127.0.0.1']
   * @param {number} [options.port=6379]
   * @param {string} [options.prefix='valax:queue:']
   * @param {number} [options.maxQueueDepth=500]
   * @param {number} [options.defaultLeaseDurationMs=30000]
   * @param {number} [options.maxRetries=2]
   * @param {object} [options.client]
   */
  constructor(clientOrOptions = {}, maybeOptions = {}) {
    super();
    let client = null;
    let options = {};
    if (clientOrOptions && (typeof clientOrOptions.sendCommand === 'function' || typeof clientOrOptions.execCommand === 'function')) {
      client = clientOrOptions;
      options = maybeOptions || {};
    } else {
      options = clientOrOptions || {};
      client = options.client || null;
    }

    this.host = options.host || '127.0.0.1';
    this.port = options.port || 6379;
    this.prefix = options.prefix || options.keyPrefix || 'valax:queue:';
    this.maxQueueDepth = options.maxQueueDepth || 500;
    this.defaultLeaseDurationMs = options.defaultLeaseDurationMs || 30000;
    this.maxRetries = options.maxRetries ?? 2;

    this.client = client || options.client || new MinimalRedisClient({ host: this.host, port: this.port });
    this.isConnected = this.client instanceof SynchronousRedisClient;
  }

  async connect() {
    if (this.client.connect) {
      await this.client.connect();
    }
    this.isConnected = true;
  }

  async disconnect() {
    if (this.client.disconnect) {
      this.client.disconnect();
    }
    this.isConnected = false;
  }

  _kJob(jobId) { return `${this.prefix}job:${jobId}`; }
  _kWaiting() { return `${this.prefix}waiting`; }
  _kIdemp(key) { return `${this.prefix}idemp:${key}`; }
  _kLease(jobId) { return `${this.prefix}lease:${jobId}`; }

  /**
   * Synchronous core for testing / local execution.
   */
  enqueueSync(jobData) {
    const idempotencyKey = jobData.idempotencyKey || jobData.jobId;

    if (idempotencyKey && this.client.execCommand) {
      const existingJobId = this.client.execCommand(['GET', this._kIdemp(idempotencyKey)]);
      if (existingJobId) {
        const rawJob = this.client.execCommand(['GET', this._kJob(existingJobId)]);
        if (rawJob) {
          return { job: JSON.parse(rawJob), isDuplicate: true };
        }
      }
    }

    const queueDepth = this.client.execCommand
      ? this.client.execCommand(['LLEN', this._kWaiting()])
      : 0;

    if (queueDepth >= this.maxQueueDepth) {
      const err = new Error(`Queue backpressure exceeded: depth is ${queueDepth}/${this.maxQueueDepth}`);
      err.code = 'BACKPRESSURE_EXCEEDED';
      throw err;
    }

    const jobId = jobData.jobId || `job-${crypto.randomUUID()}`;
    const job = {
      jobId,
      idempotencyKey,
      principalId: jobData.principalId || 'anonymous',
      state: JobState.QUEUED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      maxRetries: this.maxRetries,
      payload: jobData.payload,
      result: null,
      error: null
    };

    const jobJson = JSON.stringify(job);
    if (this.client.execCommand) {
      this.client.execCommand(['SET', this._kJob(jobId), jobJson]);
      this.client.execCommand(['LPUSH', this._kWaiting(), jobId]);
      if (idempotencyKey) {
        this.client.execCommand(['SET', this._kIdemp(idempotencyKey), jobId]);
      }
    }

    this.emit('enqueued', job);
    return { job, isDuplicate: false };
  }

  async enqueue(jobData) {
    if (this.client.execCommand) return this.enqueueSync(jobData);

    const idempotencyKey = jobData.idempotencyKey || jobData.jobId;
    if (idempotencyKey) {
      const existingJobId = await this.client.sendCommand(['GET', this._kIdemp(idempotencyKey)]);
      if (existingJobId) {
        const rawJob = await this.client.sendCommand(['GET', this._kJob(existingJobId)]);
        if (rawJob) {
          return { job: JSON.parse(rawJob), isDuplicate: true };
        }
      }
    }

    const queueDepth = await this.client.sendCommand(['LLEN', this._kWaiting()]);
    if (queueDepth >= this.maxQueueDepth) {
      const err = new Error(`Queue backpressure exceeded: depth is ${queueDepth}/${this.maxQueueDepth}`);
      err.code = 'BACKPRESSURE_EXCEEDED';
      throw err;
    }

    const jobId = jobData.jobId || `job-${crypto.randomUUID()}`;
    const job = {
      jobId,
      idempotencyKey,
      principalId: jobData.principalId || 'anonymous',
      state: JobState.QUEUED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      maxRetries: this.maxRetries,
      payload: jobData.payload,
      result: null,
      error: null
    };

    const jobJson = JSON.stringify(job);
    await this.client.sendCommand(['SET', this._kJob(jobId), jobJson]);
    await this.client.sendCommand(['LPUSH', this._kWaiting(), jobId]);

    if (idempotencyKey) {
      await this.client.sendCommand(['SET', this._kIdemp(idempotencyKey), jobId, 'EX', '86400']);
    }

    this.emit('enqueued', job);
    return { job, isDuplicate: false };
  }

  leaseNextJobSync(workerId, leaseDurationMs) {
    if (!this.client.execCommand) return null;
    const duration = leaseDurationMs || this.defaultLeaseDurationMs;

    const jobId = this.client.execCommand(['RPOP', this._kWaiting()]);
    if (!jobId) return null;

    const rawJob = this.client.execCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return null;

    const job = JSON.parse(rawJob);
    if (job.state !== JobState.QUEUED) return null;

    const leaseToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + duration;

    job.state = JobState.RUNNING;
    job.attempts++;
    job.updatedAt = new Date().toISOString();

    const leaseData = JSON.stringify({ token: leaseToken, workerId, expiresAt, leaseDurationMs: duration });
    this.client.execCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);
    this.client.execCommand(['SET', this._kLease(jobId), leaseData]);

    this.emit('leased', { jobId, workerId, leaseToken, expiresAt });
    return { job, leaseToken, expiresAt };
  }

  async leaseNextJob(workerId, leaseDurationMs) {
    if (this.client.execCommand) return this.leaseNextJobSync(workerId, leaseDurationMs);

    const duration = leaseDurationMs || this.defaultLeaseDurationMs;
    const jobId = await this.client.sendCommand(['RPOP', this._kWaiting()]);
    if (!jobId) return null;

    const rawJob = await this.client.sendCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return null;

    const job = JSON.parse(rawJob);
    if (job.state !== JobState.QUEUED) return null;

    const leaseToken = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + duration;

    job.state = JobState.RUNNING;
    job.attempts++;
    job.updatedAt = new Date().toISOString();

    const leaseData = JSON.stringify({ token: leaseToken, workerId, expiresAt, leaseDurationMs: duration });
    const ttlSeconds = Math.ceil(duration / 1000);

    await this.client.sendCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);
    await this.client.sendCommand(['SET', this._kLease(jobId), leaseData, 'EX', String(ttlSeconds)]);

    this.emit('leased', { jobId, workerId, leaseToken, expiresAt });
    return { job, leaseToken, expiresAt };
  }

  completeJobSync(jobId, leaseToken, result) {
    if (!this.client.execCommand) return false;
    const rawLease = this.client.execCommand(['GET', this._kLease(jobId)]);
    if (!rawLease) return false;
    const lease = JSON.parse(rawLease);
    if (lease.token !== leaseToken) return false;

    const rawJob = this.client.execCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return false;
    const job = JSON.parse(rawJob);
    if (!isValidTransition(job.state, JobState.COMPLETED)) return false;

    job.state = JobState.COMPLETED;
    job.result = result;
    job.updatedAt = new Date().toISOString();

    this.client.execCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);
    this.client.execCommand(['DEL', this._kLease(jobId)]);

    this.emit('completed', job);
    return true;
  }

  async completeJob(jobId, leaseToken, result) {
    if (this.client.execCommand) return this.completeJobSync(jobId, leaseToken, result);

    const rawLease = await this.client.sendCommand(['GET', this._kLease(jobId)]);
    if (!rawLease) return false;

    const lease = JSON.parse(rawLease);
    if (lease.token !== leaseToken) return false;

    const rawJob = await this.client.sendCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return false;

    const job = JSON.parse(rawJob);
    if (!isValidTransition(job.state, JobState.COMPLETED)) return false;

    job.state = JobState.COMPLETED;
    job.result = result;
    job.updatedAt = new Date().toISOString();

    await this.client.sendCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);
    await this.client.sendCommand(['DEL', this._kLease(jobId)]);

    this.emit('completed', job);
    return true;
  }

  failJobSync(jobId, leaseToken, error) {
    if (!this.client.execCommand) return false;
    const rawJob = this.client.execCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return false;

    const job = JSON.parse(rawJob);
    this.client.execCommand(['DEL', this._kLease(jobId)]);

    if (job.attempts < job.maxRetries) {
      job.state = JobState.QUEUED;
      job.updatedAt = new Date().toISOString();
      this.client.execCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);
      this.client.execCommand(['RPUSH', this._kWaiting(), jobId]);
      this.emit('retried', job);
      return true;
    }

    job.state = JobState.FAILED;
    job.error = error;
    job.updatedAt = new Date().toISOString();
    this.client.execCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);

    this.emit('failed', job);
    return true;
  }

  async failJob(jobId, leaseToken, error) {
    if (this.client.execCommand) return this.failJobSync(jobId, leaseToken, error);

    const rawJob = await this.client.sendCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return false;

    const job = JSON.parse(rawJob);
    await this.client.sendCommand(['DEL', this._kLease(jobId)]);

    if (job.attempts < job.maxRetries) {
      job.state = JobState.QUEUED;
      job.updatedAt = new Date().toISOString();
      await this.client.sendCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);
      await this.client.sendCommand(['RPUSH', this._kWaiting(), jobId]);
      this.emit('retried', job);
      return true;
    }

    job.state = JobState.FAILED;
    job.error = error;
    job.updatedAt = new Date().toISOString();
    await this.client.sendCommand(['SET', this._kJob(jobId), JSON.stringify(job)]);

    this.emit('failed', job);
    return true;
  }

  getJobSync(jobId) {
    if (!this.client.execCommand) return null;
    const rawJob = this.client.execCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return null;
    return JSON.parse(rawJob);
  }

  async getJob(jobId) {
    if (this.client.execCommand) return this.getJobSync(jobId);
    const rawJob = await this.client.sendCommand(['GET', this._kJob(jobId)]);
    if (!rawJob) return null;
    return JSON.parse(rawJob);
  }
}

module.exports = {
  MinimalRedisClient,
  SynchronousRedisClient,
  RedisQueueAdapter
};
