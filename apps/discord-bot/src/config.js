const REQUIRED_KEYS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'DEOBFUSCATE_CHANNEL_ID',
  'SUPPORT_ROLE_ID',
  'VALAX_API_URL',
  'INTERNAL_BOT_SERVICE_SECRET'
];

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function loadConfig(env = process.env) {
  const missing = REQUIRED_KEYS.filter(key => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return {
    token: env.DISCORD_BOT_TOKEN,
    clientId: env.DISCORD_CLIENT_ID,
    guildId: env.DISCORD_GUILD_ID,
    channelId: env.DEOBFUSCATE_CHANNEL_ID,
    supporterRoleId: env.SUPPORT_ROLE_ID,
    statusText: (env.SUPPORT_STATUS_TEXT || 'support valaxscrub.shop').trim().toLowerCase(),
    apiUrl: env.VALAX_API_URL.replace(/\/+$/, ''),
    apiSecret: env.INTERNAL_BOT_SERVICE_SECRET,
    localRecovery: readBoolean(env.LOCAL_RECOVERY_ENABLED, true),
    workerTimeoutMs: readPositiveInt(env.WORKER_TIMEOUT_SECONDS, 300) * 1000,
    workerMemoryMb: readPositiveInt(env.WORKER_MEMORY_MB, 3072),
    cooldownMs: readPositiveInt(env.COOLDOWN_SECONDS, 1200) * 1000,
    maxSourceBytes: readPositiveInt(env.MAX_SOURCE_BYTES, 2_000_000)
  };
}

module.exports = { loadConfig, readBoolean, readPositiveInt, REQUIRED_KEYS };
