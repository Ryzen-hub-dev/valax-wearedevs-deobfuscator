const fs = require('fs');

if (!process.env.FFMPEG_PATH && process.platform === 'win32') {
  process.env.FFMPEG_PATH = require('ffmpeg-static');
}

const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel
} = require('@discordjs/voice');
const { ChannelType, OverwriteType, PermissionFlagsBits } = require('discord.js');

const ONBOARDING_JOIN_SETTLE_MS = 1_500;
const ONBOARDING_PLAY_TIMEOUT_MS = 600_000;
const ONBOARDING_MIN_PLAYBACK_MS = 8_000;
const ONBOARDING_POST_ROLL_MS = 750;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createOnboardingResource(audioPath) {
  if (audioPath.toLowerCase().endsWith('.ogg')) {
    return createAudioResource(fs.createReadStream(audioPath), { inputType: StreamType.OggOpus });
  }
  return createAudioResource(audioPath);
}

function waitForPlaybackEnd(player, timeoutMs = ONBOARDING_PLAY_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      player.off(AudioPlayerStatus.Idle, onIdle);
      player.off('error', onError);
    };
    const onIdle = () => {
      cleanup();
      resolve();
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Onboarding audio exceeded 10 minutes.'));
    }, timeoutMs);

    player.once(AudioPlayerStatus.Idle, onIdle);
    player.once('error', onError);
  });
}

function shouldOnboard(member, verifiedRoleId) {
  return Boolean(
    member &&
    !member.user?.bot &&
    !member.permissions?.has(PermissionFlagsBits.Administrator) &&
    !member.roles?.cache?.has(verifiedRoleId)
  );
}

function privateVoiceName(member) {
  const base = String(member?.user?.username || 'member')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'member';
  return `welcome-${base}-${String(member.id).slice(-4)}`;
}

class VoiceService {
  constructor(client, config) {
    this.client = client;
    this.config = config;
    this.guild = null;
    this.privateChannels = new Map();
    this.activeMembers = new Set();
    this.queue = Promise.resolve();
    this.mode = 'idle';
    this.stopped = false;
    this.radioRetryTimer = null;
    this.radioStartPromise = null;
    this.cleanupTimer = null;
    this.monitoredConnections = new WeakSet();
    this.radioPlayer = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });
    this.radioPlayer.on('error', error => {
      console.error(`AFK radio playback failed: ${error.message}`);
      this.scheduleRadioRetry();
    });
    this.radioPlayer.on(AudioPlayerStatus.Idle, () => {
      if (this.mode === 'radio') this.scheduleRadioRetry();
    });
  }

  get enabled() {
    return Boolean(
      this.config.voiceEnabled &&
      this.config.verifiedRoleId &&
      this.config.onboardingCategoryId &&
      this.config.afkVoiceChannelId
    );
  }

  async start(guild) {
    this.guild = guild;
    if (!this.enabled) {
      console.log('Discord voice onboarding is disabled until discord:setup has saved its channel IDs.');
      return;
    }
    if (!fs.existsSync(this.config.onboardingAudioPath)) {
      throw new Error(`Onboarding audio was not found: ${this.config.onboardingAudioPath}`);
    }

    await guild.channels.fetch();
    await guild.roles.fetch();
    const role = guild.roles.cache.get(this.config.verifiedRoleId);
    const category = guild.channels.cache.get(this.config.onboardingCategoryId);
    const afkChannel = guild.channels.cache.get(this.config.afkVoiceChannelId);
    if (!role || category?.type !== ChannelType.GuildCategory || afkChannel?.type !== ChannelType.GuildVoice) {
      throw new Error('Discord voice onboarding IDs are invalid; run npm run discord:setup again.');
    }

    await this.reconcilePrivateChannels();
    await this.startRadio();
    this.cleanupTimer = setInterval(() => {
      this.reconcilePrivateChannels().catch(error => {
        console.error(`Voice room reconciliation failed: ${error.message}`);
      });
    }, 10 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  async reconcilePrivateChannels() {
    const category = this.guild.channels.cache.get(this.config.onboardingCategoryId);
    // ClientReady already populated the member cache. Re-fetching the entire
    // guild here immediately after presence reconciliation can trip Discord's
    // opcode 8 rate limit and prevent voice startup altogether.
    const members = this.guild.members.cache;

    for (const channel of category.children.cache.values()) {
      if (channel.type !== ChannelType.GuildVoice) continue;
      const memberOverwrite = channel.permissionOverwrites.cache.find(overwrite =>
        overwrite.type === OverwriteType.Member && overwrite.id !== this.client.user.id
      );
      const member = memberOverwrite ? members.get(memberOverwrite.id) : null;
      if (!member || !shouldOnboard(member, this.config.verifiedRoleId)) {
        await channel.delete('Removing completed or orphaned onboarding channel').catch(() => {});
        continue;
      }
      this.privateChannels.set(member.id, channel.id);
    }

    for (const member of members.values()) {
      if (shouldOnboard(member, this.config.verifiedRoleId)) await this.createPrivateChannel(member);
    }
  }

  async createPrivateChannel(member) {
    if (!this.enabled || !shouldOnboard(member, this.config.verifiedRoleId)) return null;
    const existingId = this.privateChannels.get(member.id);
    if (existingId) return this.guild.channels.cache.get(existingId) || null;

    const channel = await this.guild.channels.create({
      name: privateVoiceName(member),
      type: ChannelType.GuildVoice,
      parent: this.config.onboardingCategoryId,
      userLimit: 1,
      permissionOverwrites: [
        {
          id: this.guild.roles.everyone.id,
          deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]
        },
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.UseVAD
          ]
        },
        {
          id: this.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageChannels
          ]
        }
      ],
      reason: `Private onboarding voice room for ${member.user.tag}`
    });
    this.privateChannels.set(member.id, channel.id);
    return channel;
  }

  async handleMemberAdd(member) {
    if (!this.enabled || member.guild.id !== this.config.guildId) return;
    try {
      await this.createPrivateChannel(member);
    } catch (error) {
      console.error(`Unable to create onboarding room for ${member.id}: ${error.message}`);
    }
  }

  async handleMemberRemove(member) {
    const channelId = this.privateChannels.get(member.id);
    this.privateChannels.delete(member.id);
    if (channelId) {
      const channel = member.guild.channels.cache.get(channelId);
      if (channel) await channel.delete('Member left before onboarding').catch(() => {});
    }
  }

  handleVoiceStateUpdate(oldState, newState) {
    if (!this.enabled || newState.member?.user?.bot || oldState.channelId === newState.channelId) return;
    const expectedChannelId = this.privateChannels.get(newState.id);
    if (!expectedChannelId || newState.channelId !== expectedChannelId || this.activeMembers.has(newState.id)) return;

    this.activeMembers.add(newState.id);
    this.queue = this.queue.then(async () => {
      try {
        await this.runOnboarding(newState.id, expectedChannelId);
      } catch (error) {
        console.error(`Voice onboarding failed for ${newState.id}: ${error.message}`);
      } finally {
        this.activeMembers.delete(newState.id);
      }
    });
  }

  async runOnboarding(memberId, channelId) {
    const member = await this.guild.members.fetch(memberId);
    const channel = await this.guild.channels.fetch(channelId);
    if (!channel || !shouldOnboard(member, this.config.verifiedRoleId)) return;
    if (member.voice.channelId !== channel.id) return;

    this.mode = 'onboarding';
    clearTimeout(this.radioRetryTimer);
    this.radioRetryTimer = null;
    this.radioPlayer.stop(true);
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });

    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
    player.on('error', error => {
      console.error(`Voice onboarding playback error for ${memberId}: ${error.message}`);
    });
    let subscription;
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      subscription = connection.subscribe(player);
      await delay(ONBOARDING_JOIN_SETTLE_MS);
      if (member.voice.channelId !== channel.id) {
        throw new Error('Member left before onboarding playback started.');
      }

      const resource = createOnboardingResource(this.config.onboardingAudioPath);
      player.play(resource);
      await entersState(player, AudioPlayerStatus.Playing, 15_000);
      const playbackStartedAt = Date.now();
      console.log(`Voice onboarding audio started for ${member.id}.`);
      await waitForPlaybackEnd(player);
      const playbackMs = Date.now() - playbackStartedAt;
      if (playbackMs < ONBOARDING_MIN_PLAYBACK_MS) {
        throw new Error(`Onboarding audio ended too early after ${playbackMs}ms; member was not unlocked.`);
      }
      await delay(ONBOARDING_POST_ROLL_MS);

      await member.fetch();
      if (member.voice.channelId !== channel.id) {
        throw new Error('Member left before the onboarding audio finished.');
      }
      await member.roles.add(this.config.verifiedRoleId, 'Completed voice onboarding');
      await member.voice.disconnect('Completed voice onboarding').catch(() => {});
      await channel.delete('Voice onboarding completed');
      this.privateChannels.delete(member.id);
      console.log(`Voice onboarding completed for ${member.id} after ${playbackMs}ms.`);
    } finally {
      subscription?.unsubscribe();
      player.stop(true);
      this.mode = 'idle';
      await this.startRadio();
    }
  }

  async startRadio() {
    if (!this.enabled || this.stopped || this.mode === 'onboarding') return;
    if (this.radioStartPromise) return this.radioStartPromise;

    this.radioStartPromise = (async () => {
      const channel = await this.guild.channels.fetch(this.config.afkVoiceChannelId);
      if (!channel || channel.type !== ChannelType.GuildVoice) throw new Error('AFK voice channel is unavailable.');
      this.mode = 'radio';
      const connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: this.guild.id,
        adapterCreator: this.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false
      });
      this.monitorConnection(connection);
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      connection.subscribe(this.radioPlayer);
      this.radioPlayer.play(createAudioResource(this.config.radioStreamUrl));
      console.log(`AFK radio is playing in ${channel.name}.`);
    })();

    try {
      await this.radioStartPromise;
    } catch (error) {
      this.mode = 'idle';
      console.error(`Unable to start AFK radio: ${error.message}`);
      this.scheduleRadioRetry();
    } finally {
      this.radioStartPromise = null;
    }
  }

  monitorConnection(connection) {
    if (this.monitoredConnections.has(connection)) return;
    this.monitoredConnections.add(connection);
    connection.on('stateChange', (_oldState, newState) => {
      if (newState.status === VoiceConnectionStatus.Disconnected && this.mode === 'radio') {
        console.error('AFK radio voice connection disconnected; reconnecting.');
        this.scheduleRadioRetry();
      }
      if (newState.status === VoiceConnectionStatus.Destroyed && !this.stopped && this.mode === 'radio') {
        this.mode = 'idle';
        this.scheduleRadioRetry();
      }
    });
  }

  scheduleRadioRetry() {
    if (!this.enabled || this.stopped || this.mode === 'onboarding' || this.radioRetryTimer) return;
    clearTimeout(this.radioRetryTimer);
    this.radioRetryTimer = setTimeout(() => {
      this.radioRetryTimer = null;
      this.startRadio();
    }, 5_000);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.radioRetryTimer);
    this.radioRetryTimer = null;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.radioPlayer.stop(true);
    const connection = this.guild ? getVoiceConnection(this.guild.id) : null;
    if (connection) connection.destroy();
  }
}

module.exports = { VoiceService, privateVoiceName, shouldOnboard };
