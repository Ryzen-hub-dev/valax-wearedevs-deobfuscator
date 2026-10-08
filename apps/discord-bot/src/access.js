function normalizeActivityText(activity) {
  return [activity?.state, activity?.details, activity?.name]
    .filter(value => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function hasSupportStatus(presence, requiredText) {
  if (!presence || !requiredText) return false;
  const needle = requiredText.trim().toLowerCase();
  return presence.activities?.some(activity => {
    const isCustomStatus = activity?.type === 4 || activity?.name === 'Custom Status';
    return isCustomStatus && normalizeActivityText(activity).includes(needle);
  }) || false;
}

class CooldownStore {
  constructor(durationMs, now = () => Date.now()) {
    this.durationMs = durationMs;
    this.now = now;
    this.entries = new Map();
  }

  remaining(userId) {
    const expiresAt = this.entries.get(userId) || 0;
    const remainingMs = expiresAt - this.now();
    if (remainingMs <= 0) {
      this.entries.delete(userId);
      return 0;
    }
    return remainingMs;
  }

  start(userId) {
    this.entries.set(userId, this.now() + this.durationMs);
  }

  clear(userId) {
    this.entries.delete(userId);
  }
}

function formatRemaining(remainingMs) {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

module.exports = { CooldownStore, formatRemaining, hasSupportStatus, normalizeActivityText };
