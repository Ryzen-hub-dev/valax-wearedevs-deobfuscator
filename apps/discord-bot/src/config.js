const path = require('path');

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

function readTokenList(value) {
  return [...new Set(String(value || '').split(/[\s,;]+/).map(token => token.trim()).filter(Boolean))];
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
    voiceEnabled: readBoolean(env.VOICE_ENABLED, false),
    verifiedRoleId: env.VERIFIED_ROLE_ID || '',
    onboardingCategoryId: env.ONBOARDING_CATEGORY_ID || '',
    afkVoiceChannelId: env.AFK_VOICE_CHANNEL_ID || '',
    onboardingAudioPath: env.ONBOARDING_AUDIO_PATH || path.resolve(__dirname, '../assets/onboarding.ogg'),
    onboardingHelperTokens: readTokenList(env.ONBOARDING_HELPER_BOT_TOKENS),
    radioStreamUrl: env.RADIO_STREAM_URL || 'http://streaming.exclusive.radio/er/billyeilish/icecast.audio',
    communityEnabled: readBoolean(env.COMMUNITY_ENABLED, true),
    communityDataPath: env.COMMUNITY_DATA_PATH || path.resolve(__dirname, '../data/community.json'),
    ticketsCategoryId: env.TICKETS_CATEGORY_ID || '',
    communityHubChannelId: env.COMMUNITY_HUB_CHANNEL_ID || '',
    countingChannelId: env.COUNTING_CHANNEL_ID || '',
    applicationsChannelId: env.APPLICATIONS_CHANNEL_ID || '',
    loaChannelId: env.LOA_CHANNEL_ID || '',
    giveawayChannelId: env.GIVEAWAY_CHANNEL_ID || '',
    communityLogChannelId: env.COMMUNITY_LOG_CHANNEL_ID || '',
    staffRoleId: env.STAFF_ROLE_ID || '',
    ticketDeleteDelayMs: readPositiveInt(env.TICKET_DELETE_DELAY_SECONDS, 30) * 1000,
    messageContentEnabled: readBoolean(env.MESSAGE_CONTENT_ENABLED, false),
    xpCooldownMs: readPositiveInt(env.XP_COOLDOWN_SECONDS, 60) * 1000,
    websiteUrl: env.COMMUNITY_WEBSITE_URL || 'https://valax-wearedevs-deobfuscator.vercel.app',
    dashboardUrl: env.COMMUNITY_DASHBOARD_URL || 'https://valax-wearedevs-deobfuscator.vercel.app/community.html',
    dashboardEnabled: readBoolean(env.COMMUNITY_DASHBOARD_ENABLED, true),
    dashboardHost: env.COMMUNITY_DASHBOARD_HOST || '127.0.0.1',
    dashboardPort: readPositiveInt(env.COMMUNITY_DASHBOARD_PORT, 3080),
    workerTimeoutMs: readPositiveInt(env.WORKER_TIMEOUT_SECONDS, 30) * 1000,
    workerMemoryMb: readPositiveInt(env.WORKER_MEMORY_MB, 3072),
    cooldownMs: readPositiveInt(env.COOLDOWN_SECONDS, 1200) * 1000,
    maxSourceBytes: readPositiveInt(env.MAX_SOURCE_BYTES, 2_000_000)
  };
}

module.exports = { loadConfig, readBoolean, readPositiveInt, readTokenList, REQUIRED_KEYS };
