const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DEFAULT_STATE = Object.freeze({
  version: 1,
  users: {},
  tickets: {},
  applications: {},
  leaves: {},
  drops: {},
  counting: { current: 0, highScore: 0, lastUserId: null },
  invites: { members: {}, inviters: {} },
  warnings: {},
  activity: [],
  stats: {
    ticketsClosed: 0,
    applicationsReviewed: 0,
    leavesReviewed: 0,
    dropsClaimed: 0,
    systemErrors: 0
  }
});

function freshState() {
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeState(value) {
  const initial = freshState();
  if (!isRecord(value)) return initial;
  return {
    ...initial,
    ...value,
    users: isRecord(value.users) ? value.users : {},
    tickets: isRecord(value.tickets) ? value.tickets : {},
    applications: isRecord(value.applications) ? value.applications : {},
    leaves: isRecord(value.leaves) ? value.leaves : {},
    drops: isRecord(value.drops) ? value.drops : {},
    counting: { ...initial.counting, ...(isRecord(value.counting) ? value.counting : {}) },
    invites: {
      members: isRecord(value.invites?.members) ? value.invites.members : {},
      inviters: isRecord(value.invites?.inviters) ? value.invites.inviters : {}
    },
    warnings: isRecord(value.warnings) ? value.warnings : {},
    activity: Array.isArray(value.activity) ? value.activity.slice(0, 100) : [],
    stats: { ...initial.stats, ...(isRecord(value.stats) ? value.stats : {}) }
  };
}

class CommunityStore {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.now = options.now || Date.now;
    this.state = this.load();
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) return freshState();
      return normalizeState(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
    } catch (error) {
      const backupPath = `${this.filePath}.invalid-${Date.now()}`;
      try {
        fs.renameSync(this.filePath, backupPath);
      } catch {}
      console.error(`Community data was invalid and moved aside: ${error.message}`);
      return freshState();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    fs.renameSync(temporaryPath, this.filePath);
  }

  user(userId) {
    if (!this.state.users[userId]) {
      this.state.users[userId] = {
        coins: 0,
        xp: 0,
        messages: 0,
        lastDailyAt: 0,
        lastXpAt: 0,
        createdAt: this.now()
      };
    }
    return this.state.users[userId];
  }

  balance(userId) {
    const user = this.user(userId);
    const xp = user.xp || 0;
    return { coins: user.coins || 0, xp, level: levelForXp(xp), messages: user.messages || 0 };
  }

  addCoins(userId, amount, reason = 'reward') {
    if (!Number.isSafeInteger(amount)) throw new TypeError('Coin amount must be an integer.');
    const user = this.user(userId);
    user.coins = Math.max(0, (user.coins || 0) + amount);
    this.recordActivity('economy', `${amount >= 0 ? '+' : ''}${amount} coins: ${reason}`);
    this.save();
    return user.coins;
  }

  claimDaily(userId, options = {}) {
    const now = this.now();
    const cooldownMs = options.cooldownMs || 86_400_000;
    const amount = options.amount || 150;
    const user = this.user(userId);
    const availableAt = (user.lastDailyAt || 0) + cooldownMs;
    if (user.lastDailyAt && availableAt > now) {
      return { ok: false, availableAt, remainingMs: availableAt - now };
    }
    user.lastDailyAt = now;
    user.coins = (user.coins || 0) + amount;
    this.recordActivity('economy', `Daily reward claimed: +${amount} coins`);
    this.save();
    return { ok: true, amount, balance: user.coins, availableAt: now + cooldownMs };
  }

  leaderboard(limit = 10) {
    return Object.entries(this.state.users)
      .map(([userId, value]) => ({ userId, coins: value.coins || 0, xp: value.xp || 0 }))
      .sort((left, right) => right.coins - left.coins || right.xp - left.xp)
      .slice(0, Math.max(1, Math.min(25, limit)));
  }

  awardMessageXp(userId, options = {}) {
    const now = this.now();
    const cooldownMs = options.cooldownMs || 60_000;
    const amount = options.amount || 15;
    const user = this.user(userId);
    if (user.lastXpAt && user.lastXpAt + cooldownMs > now) return { awarded: false };
    const previousLevel = levelForXp(user.xp || 0);
    user.lastXpAt = now;
    user.messages = (user.messages || 0) + 1;
    user.xp = (user.xp || 0) + amount;
    const level = levelForXp(user.xp);
    if (level > previousLevel) this.recordActivity('level', `A community member reached level ${level}.`);
    this.save();
    return {
      awarded: true,
      amount,
      xp: user.xp,
      level,
      previousLevel,
      leveledUp: level > previousLevel
    };
  }

  submitCount(userId, value) {
    const counting = this.state.counting;
    const expected = counting.current + 1;
    if (!Number.isSafeInteger(value) || value !== expected || counting.lastUserId === userId) {
      const previous = counting.current;
      counting.current = 0;
      counting.lastUserId = null;
      this.recordActivity('counting', `Counting reset at ${previous}; next number is 1.`);
      this.save();
      return { accepted: false, expected, previous, highScore: counting.highScore };
    }
    counting.current = value;
    counting.lastUserId = userId;
    counting.highScore = Math.max(counting.highScore || 0, value);
    this.save();
    return { accepted: true, current: value, highScore: counting.highScore };
  }

  recordInvite(inviterId, memberId, details = {}) {
    if (this.state.invites.members[memberId]) return { recorded: false, reason: 'already-recorded' };
    const eligible = details.eligible !== false && inviterId && inviterId !== memberId;
    this.state.invites.members[memberId] = {
      inviterId: inviterId || null,
      code: details.code || null,
      eligible,
      joinedAt: this.now()
    };
    if (eligible) {
      const inviter = this.inviter(inviterId);
      inviter.credited += 1;
      this.recordActivity('invite', 'A verified invite was credited.');
    }
    this.save();
    return { recorded: true, eligible, stats: inviterId ? this.inviteStats(inviterId) : null };
  }

  inviter(userId) {
    if (!this.state.invites.inviters[userId]) {
      this.state.invites.inviters[userId] = { credited: 0, claimedMilestones: [] };
    }
    return this.state.invites.inviters[userId];
  }

  inviteStats(userId) {
    const inviter = this.inviter(userId);
    return { credited: inviter.credited || 0, claimedMilestones: [...(inviter.claimedMilestones || [])] };
  }

  claimInviteRewards(userId, milestones) {
    const inviter = this.inviter(userId);
    const available = milestones.filter(item =>
      inviter.credited >= item.invites && !inviter.claimedMilestones.includes(item.invites)
    );
    if (available.length === 0) return { claimed: false, stats: this.inviteStats(userId) };
    const amount = available.reduce((sum, item) => sum + item.coins, 0);
    inviter.claimedMilestones.push(...available.map(item => item.invites));
    const user = this.user(userId);
    user.coins = (user.coins || 0) + amount;
    this.recordActivity('invite', `Invite rewards claimed: +${amount} coins.`);
    this.save();
    return { claimed: true, amount, milestones: available, balance: user.coins, stats: this.inviteStats(userId) };
  }

  addWarning(userId, moderatorId, reason) {
    const warning = { id: randomUUID(), userId, moderatorId, reason, createdAt: this.now() };
    if (!Array.isArray(this.state.warnings[userId])) this.state.warnings[userId] = [];
    this.state.warnings[userId].push(warning);
    this.recordActivity('moderation', 'A staff warning was recorded.');
    this.save();
    return warning;
  }

  warningsFor(userId) {
    return Array.isArray(this.state.warnings[userId]) ? [...this.state.warnings[userId]] : [];
  }

  clearWarnings(userId) {
    const count = this.warningsFor(userId).length;
    this.state.warnings[userId] = [];
    this.recordActivity('moderation', `${count} warning record(s) cleared.`);
    this.save();
    return count;
  }

  openTicketForUser(userId) {
    return Object.values(this.state.tickets).find(ticket =>
      ticket.userId === userId && ticket.status === 'open'
    ) || null;
  }

  createTicket(userId, channelId) {
    const existing = this.openTicketForUser(userId);
    if (existing) return { created: false, ticket: existing };
    const ticket = {
      id: randomUUID(),
      userId,
      channelId,
      status: 'open',
      createdAt: this.now(),
      closedAt: null,
      closedBy: null
    };
    this.state.tickets[ticket.id] = ticket;
    this.recordActivity('ticket', 'A new support ticket was opened.');
    this.save();
    return { created: true, ticket };
  }

  closeTicket(ticketId, closedBy, archive = {}) {
    const ticket = this.state.tickets[ticketId];
    if (!ticket || ticket.status !== 'open') return null;
    ticket.status = 'closed';
    ticket.closedAt = this.now();
    ticket.closedBy = closedBy;
    ticket.transcriptFile = archive.transcriptFile || null;
    ticket.messageCount = Number.isSafeInteger(archive.messageCount) ? archive.messageCount : 0;
    this.state.stats.ticketsClosed += 1;
    this.recordActivity('ticket', 'A support ticket was closed.');
    this.save();
    return ticket;
  }

  createApplication(userId, answers) {
    const application = {
      id: randomUUID(),
      userId,
      answers,
      status: 'pending',
      createdAt: this.now(),
      reviewedAt: null,
      reviewedBy: null
    };
    this.state.applications[application.id] = application;
    this.recordActivity('application', 'A staff application is awaiting review.');
    this.save();
    return application;
  }

  createLeave(userId, request) {
    const leave = {
      id: randomUUID(),
      userId,
      ...request,
      status: 'pending',
      createdAt: this.now(),
      reviewedAt: null,
      reviewedBy: null
    };
    this.state.leaves[leave.id] = leave;
    this.recordActivity('leave', 'A staff leave request is awaiting review.');
    this.save();
    return leave;
  }

  review(collectionName, itemId, status, reviewedBy) {
    const collection = this.state[collectionName];
    const item = collection?.[itemId];
    if (!item || item.status !== 'pending' || !['approved', 'rejected'].includes(status)) return null;
    item.status = status;
    item.reviewedAt = this.now();
    item.reviewedBy = reviewedBy;
    if (collectionName === 'applications') this.state.stats.applicationsReviewed += 1;
    if (collectionName === 'leaves') this.state.stats.leavesReviewed += 1;
    this.recordActivity(collectionName, `${collectionName === 'applications' ? 'Application' : 'Leave'} ${status}.`);
    this.save();
    return item;
  }

  createDrop(createdBy, prize, channelId, messageId = null) {
    const drop = {
      id: randomUUID(),
      createdBy,
      prize,
      channelId,
      messageId,
      status: 'open',
      winnerId: null,
      createdAt: this.now(),
      claimedAt: null
    };
    this.state.drops[drop.id] = drop;
    this.recordActivity('drop', `A new reward drop opened: ${prize}`);
    this.save();
    return drop;
  }

  setDropMessage(dropId, messageId) {
    const drop = this.state.drops[dropId];
    if (!drop) return null;
    drop.messageId = messageId;
    this.save();
    return drop;
  }

  claimDrop(dropId, winnerId, coinReward = 250) {
    const drop = this.state.drops[dropId];
    if (!drop || drop.status !== 'open') return null;
    drop.status = 'claimed';
    drop.winnerId = winnerId;
    drop.claimedAt = this.now();
    const user = this.user(winnerId);
    user.coins = (user.coins || 0) + coinReward;
    this.state.stats.dropsClaimed += 1;
    this.recordActivity('drop', `A reward drop was claimed (+${coinReward} coins).`);
    this.save();
    return drop;
  }

  recordActivity(type, text) {
    this.state.activity.unshift({ id: randomUUID(), type, text, createdAt: this.now() });
    this.state.activity = this.state.activity.slice(0, 100);
  }

  recordSystemError() {
    this.state.stats.systemErrors += 1;
    this.save();
  }

  snapshot() {
    const values = collection => Object.values(collection);
    return {
      tickets: {
        open: values(this.state.tickets).filter(item => item.status === 'open').length,
        closed: this.state.stats.ticketsClosed
      },
      applications: {
        pending: values(this.state.applications).filter(item => item.status === 'pending').length,
        reviewed: this.state.stats.applicationsReviewed
      },
      leaves: {
        pending: values(this.state.leaves).filter(item => item.status === 'pending').length,
        reviewed: this.state.stats.leavesReviewed
      },
      economyUsers: Object.keys(this.state.users).length,
      dropsClaimed: this.state.stats.dropsClaimed,
      counting: { ...this.state.counting },
      creditedInvites: Object.values(this.state.invites.inviters)
        .reduce((sum, inviter) => sum + (inviter.credited || 0), 0),
      systemErrors: this.state.stats.systemErrors,
      activity: this.state.activity.slice(0, 12)
    };
  }
}

function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100)) + 1;
}

function xpForNextLevel(level) {
  return Math.max(0, level) ** 2 * 100;
}

module.exports = { CommunityStore, freshState, levelForXp, normalizeState, xpForNextLevel };
