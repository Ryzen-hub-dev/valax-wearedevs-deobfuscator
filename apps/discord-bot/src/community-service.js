const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const COLORS = {
  primary: 0x7C3AED,
  success: 0x22C55E,
  warning: 0xF59E0B,
  danger: 0xEF4444,
  neutral: 0x111827
};

function cleanChannelName(value) {
  const normalized = String(value || 'member')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return (normalized || 'member').slice(0, 42);
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function truncate(value, max = 1000) {
  const text = String(value || '—');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

class CommunityService {
  constructor(client, config, store) {
    this.client = client;
    this.config = config;
    this.store = store;
    this.startedAt = Date.now();
    this.presenceTimer = null;
  }

  async start(guild) {
    if (!this.config.communityEnabled) return;
    this.guild = guild;
    await this.updatePresence();
    this.presenceTimer = setInterval(() => {
      this.updatePresence().catch(error => console.error(`Community presence update failed: ${error.message}`));
    }, 60_000);
    this.presenceTimer.unref?.();
    console.log('Valax premium community modules are online.');
  }

  stop() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = null;
  }

  async updatePresence() {
    if (!this.client.user || !this.config.communityEnabled) return;
    const openTickets = this.store.snapshot().tickets.open;
    this.client.user.setPresence({
      activities: [{ name: `${openTickets} open tickets • /about`, type: 3 }],
      status: 'online'
    });
  }

  isStaff(interaction) {
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
    return Boolean(this.config.staffRoleId && interaction.member?.roles?.cache?.has(this.config.staffRoleId));
  }

  async handleInteraction(interaction) {
    if (!this.config.communityEnabled || interaction.guildId !== this.config.guildId) return false;

    if (interaction.isChatInputCommand()) {
      const handlers = {
        about: () => this.showAbout(interaction),
        balance: () => this.showBalance(interaction),
        daily: () => this.claimDaily(interaction),
        leaderboard: () => this.showLeaderboard(interaction),
        ticket: () => this.openTicket(interaction),
        apply: () => this.showApplicationModal(interaction),
        loa: () => this.showLeaveModal(interaction),
        drop: () => this.createDrop(interaction),
        'community-status': () => this.showCommunityStatus(interaction)
      };
      const handler = handlers[interaction.commandName];
      if (!handler) return false;
      await handler();
      return true;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === 'community:application') {
        await this.submitApplication(interaction);
        return true;
      }
      if (interaction.customId === 'community:leave') {
        await this.submitLeave(interaction);
        return true;
      }
      return false;
    }

    if (interaction.isButton() && interaction.customId.startsWith('community:')) {
      await this.handleButton(interaction);
      return true;
    }
    return false;
  }

  async showAbout(interaction) {
    const guild = interaction.guild;
    const members = guild.memberCount;
    const online = guild.members.cache.filter(member => member.presence?.status && member.presence.status !== 'offline').size;
    const snapshot = this.store.snapshot();
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`✦ ${guild.name}`)
      .setDescription('Valax is a gated Lua/Luau recovery community with private onboarding, developer support, rewards and staff-operated help.')
      .addFields(
        { name: 'Community', value: `**${members}** members\n**${online}** online`, inline: true },
        { name: 'Support', value: `**${snapshot.tickets.open}** open tickets\n**${snapshot.tickets.closed}** resolved`, inline: true },
        { name: 'Server', value: `**${guild.channels.cache.size}** channels\n**${guild.premiumSubscriptionCount || 0}** boosts`, inline: true },
        { name: 'Quick actions', value: '`/ticket` private support\n`/daily` reward\n`/leaderboard` economy\n`/apply` staff application' }
      )
      .setFooter({ text: 'VALAX CONTROL • premium community system' })
      .setTimestamp();
    const iconUrl = guild.iconURL({ size: 256 });
    if (iconUrl) embed.setThumbnail(iconUrl);
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Website').setStyle(ButtonStyle.Link).setURL(this.config.websiteUrl),
      new ButtonBuilder().setLabel('Dashboard').setStyle(ButtonStyle.Link).setURL(this.config.dashboardUrl)
    );
    await interaction.reply({ embeds: [embed], components: [buttons] });
  }

  async showBalance(interaction) {
    const target = interaction.options.getUser('user') || interaction.user;
    const balance = this.store.balance(target.id);
    const rank = this.store.leaderboard(25).findIndex(item => item.userId === target.id) + 1;
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setAuthor({ name: `${target.username}'s Valax wallet`, iconURL: target.displayAvatarURL() })
      .addFields(
        { name: 'Coins', value: `🪙 **${balance.coins.toLocaleString()}**`, inline: true },
        { name: 'XP', value: `✦ **${balance.xp.toLocaleString()}**`, inline: true },
        { name: 'Rank', value: rank > 0 ? `#${rank}` : 'Unranked', inline: true }
      );
    await interaction.reply({ embeds: [embed] });
  }

  async claimDaily(interaction) {
    const result = this.store.claimDaily(interaction.user.id);
    if (!result.ok) {
      await interaction.reply({
        content: `Your next daily reward is available in **${formatDuration(result.remainingMs)}**.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.success)
        .setTitle('Daily reward claimed')
        .setDescription(`You received 🪙 **${result.amount} coins**.\nNew balance: **${result.balance.toLocaleString()}**`)
        .setFooter({ text: 'Come back tomorrow for another reward.' })]
    });
  }

  async showLeaderboard(interaction) {
    const entries = this.store.leaderboard(10);
    const lines = entries.length > 0
      ? entries.map((entry, index) => `${['🥇', '🥈', '🥉'][index] || `**${index + 1}.**`} <@${entry.userId}> — 🪙 **${entry.coins.toLocaleString()}**`)
      : ['No one has claimed a reward yet. Use `/daily` to take first place.'];
    await interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.warning)
        .setTitle('Valax Economy Leaderboard')
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Ranked by coin balance' })]
    });
  }

  async openTicket(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const existing = this.store.openTicketForUser(interaction.user.id);
    if (existing) {
      await interaction.editReply({ content: `You already have an open ticket: <#${existing.channelId}>.` });
      return;
    }
    const guild = interaction.guild;
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      },
      {
        id: this.client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels
        ]
      }
    ];
    if (this.config.staffRoleId) {
      overwrites.push({
        id: this.config.staffRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
      });
    }
    let channel;
    try {
      channel = await guild.channels.create({
        name: `ticket-${cleanChannelName(interaction.user.username)}`,
        type: ChannelType.GuildText,
        parent: this.config.ticketsCategoryId || undefined,
        topic: `Private support ticket for ${interaction.user.id}`,
        permissionOverwrites: overwrites,
        reason: `Valax ticket opened by ${interaction.user.id}`
      });
      const result = this.store.createTicket(interaction.user.id, channel.id);
      const ticket = result.ticket;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`community:ticket:close:${ticket.id}`)
          .setLabel('Close ticket')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger)
      );
      await channel.send({
        content: `${interaction.user}${this.config.staffRoleId ? ` <@&${this.config.staffRoleId}>` : ''}`,
        embeds: [new EmbedBuilder()
          .setColor(COLORS.primary)
          .setTitle('Private Valax Support')
          .setDescription('Tell us what you need help with. A staff member will respond here.\n\nSource files and recovery details shared in this channel remain private to you and staff.')
          .setFooter({ text: `Ticket ${ticket.id.slice(0, 8)}` })],
        components: [row]
      });
      await interaction.editReply({ content: `Your private ticket is ready: ${channel}.` });
      await this.updatePresence();
    } catch (error) {
      if (channel) await channel.delete('Ticket setup failed').catch(() => {});
      throw error;
    }
  }

  async showApplicationModal(interaction) {
    const modal = new ModalBuilder().setCustomId('community:application').setTitle('Valax Staff Application');
    modal.addComponents(
      this.textRow('application-motivation', 'Why do you want to join the staff team?', TextInputStyle.Paragraph, 50, 800),
      this.textRow('application-experience', 'Relevant experience', TextInputStyle.Paragraph, 20, 600),
      this.textRow('application-availability', 'Timezone and weekly availability', TextInputStyle.Short, 5, 150)
    );
    await interaction.showModal(modal);
  }

  async submitApplication(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const application = this.store.createApplication(interaction.user.id, {
      motivation: interaction.fields.getTextInputValue('application-motivation'),
      experience: interaction.fields.getTextInputValue('application-experience'),
      availability: interaction.fields.getTextInputValue('application-availability')
    });
    const channel = await this.resolveTextChannel(this.config.applicationsChannelId, interaction.channel);
    if (!channel) {
      await interaction.editReply({ content: 'The application review channel is not configured yet. Please open a support ticket.' });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('New staff application')
      .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
      .addFields(
        { name: 'Motivation', value: truncate(application.answers.motivation) },
        { name: 'Experience', value: truncate(application.answers.experience) },
        { name: 'Availability', value: truncate(application.answers.availability) }
      )
      .setFooter({ text: `Application ${application.id.slice(0, 8)} • Pending` })
      .setTimestamp();
    await channel.send({ embeds: [embed], components: [this.reviewRow('application', application.id)] });
    await interaction.editReply({ content: 'Your staff application was submitted for private review.' });
  }

  async showLeaveModal(interaction) {
    if (!this.isStaff(interaction)) {
      await interaction.reply({ content: 'This command is for staff members.', flags: MessageFlags.Ephemeral });
      return;
    }
    const modal = new ModalBuilder().setCustomId('community:leave').setTitle('Leave of Absence');
    modal.addComponents(
      this.textRow('leave-days', 'Number of days (1–14)', TextInputStyle.Short, 1, 2),
      this.textRow('leave-reason', 'Reason', TextInputStyle.Paragraph, 10, 700),
      this.textRow('leave-details', 'Additional information (optional)', TextInputStyle.Paragraph, 0, 700, false)
    );
    await interaction.showModal(modal);
  }

  async submitLeave(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const days = Number.parseInt(interaction.fields.getTextInputValue('leave-days'), 10);
    if (!Number.isSafeInteger(days) || days < 1 || days > 14) {
      await interaction.editReply({ content: 'Leave length must be a number from 1 to 14 days.' });
      return;
    }
    const leave = this.store.createLeave(interaction.user.id, {
      days,
      reason: interaction.fields.getTextInputValue('leave-reason'),
      details: interaction.fields.getTextInputValue('leave-details') || '—'
    });
    const channel = await this.resolveTextChannel(this.config.loaChannelId, interaction.channel);
    if (!channel) {
      await interaction.editReply({ content: 'The leave review channel is not configured yet.' });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(COLORS.warning)
      .setTitle('Staff leave request')
      .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
      .addFields(
        { name: 'Length', value: `${days} day${days === 1 ? '' : 's'}`, inline: true },
        { name: 'Reason', value: truncate(leave.reason) },
        { name: 'Additional information', value: truncate(leave.details) }
      )
      .setFooter({ text: `Request ${leave.id.slice(0, 8)} • Pending` })
      .setTimestamp();
    await channel.send({ embeds: [embed], components: [this.reviewRow('leave', leave.id)] });
    await interaction.editReply({ content: 'Your leave request was submitted for review.' });
  }

  async createDrop(interaction) {
    if (!this.isStaff(interaction)) {
      await interaction.reply({ content: 'Only staff can create a reward drop.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const prize = interaction.options.getString('prize', true);
    const channel = await this.resolveTextChannel(this.config.giveawayChannelId, interaction.channel);
    const drop = this.store.createDrop(interaction.user.id, prize, channel.id);
    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('⚡ VALAX QUICK DROP')
      .setDescription(`The first eligible member to claim wins:\n\n## ${truncate(prize, 200)}`)
      .addFields(
        { name: 'Status', value: '🟢 Open', inline: true },
        { name: 'Bonus', value: '🪙 250 coins', inline: true },
        { name: 'Created by', value: `<@${interaction.user.id}>`, inline: true }
      )
      .setFooter({ text: 'One claim per drop • Bot accounts are not eligible' })
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`community:drop:claim:${drop.id}`)
        .setLabel('Claim reward')
        .setEmoji('⚡')
        .setStyle(ButtonStyle.Success)
    );
    const message = await channel.send({ embeds: [embed], components: [row] });
    this.store.setDropMessage(drop.id, message.id);
    await interaction.editReply({ content: `Reward drop published in ${channel}.` });
  }

  async showCommunityStatus(interaction) {
    if (!this.isStaff(interaction)) {
      await interaction.reply({ content: 'This status view is for staff.', flags: MessageFlags.Ephemeral });
      return;
    }
    const snapshot = this.store.snapshot();
    const uptime = formatDuration(Date.now() - this.startedAt);
    const memory = Math.round(process.memoryUsage().rss / 1024 / 1024);
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      embeds: [new EmbedBuilder()
        .setColor(COLORS.neutral)
        .setTitle('Valax Control Center')
        .addFields(
          { name: 'Bot', value: `Online\n${Math.round(this.client.ws.ping)} ms latency`, inline: true },
          { name: 'Runtime', value: `${uptime}\n${memory} MB memory`, inline: true },
          { name: 'Support', value: `${snapshot.tickets.open} open\n${snapshot.tickets.closed} closed`, inline: true },
          { name: 'Staff queue', value: `${snapshot.applications.pending} applications\n${snapshot.leaves.pending} leave requests`, inline: true },
          { name: 'Economy', value: `${snapshot.economyUsers} members\n${snapshot.dropsClaimed} drops claimed`, inline: true },
          { name: 'System', value: `${snapshot.systemErrors} recorded errors\nDashboard: ${this.config.dashboardUrl}`, inline: true }
        )
        .setTimestamp()]
    });
  }

  async handleButton(interaction) {
    const [, resource, action, id] = interaction.customId.split(':');
    if (resource === 'ticket' && action === 'close') return this.closeTicket(interaction, id);
    if (resource === 'application' && ['approve', 'reject'].includes(action)) {
      return this.reviewApplication(interaction, id, action === 'approve' ? 'approved' : 'rejected');
    }
    if (resource === 'leave' && ['approve', 'reject'].includes(action)) {
      return this.reviewLeave(interaction, id, action === 'approve' ? 'approved' : 'rejected');
    }
    if (resource === 'drop' && action === 'claim') return this.claimDrop(interaction, id);
    await interaction.reply({ content: 'This action is no longer available.', flags: MessageFlags.Ephemeral });
  }

  async closeTicket(interaction, ticketId) {
    const ticket = this.store.state.tickets[ticketId];
    if (!ticket || ticket.status !== 'open') {
      await interaction.reply({ content: 'This ticket is already closed.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (ticket.userId !== interaction.user.id && !this.isStaff(interaction)) {
      await interaction.reply({ content: 'Only the ticket owner or staff can close this ticket.', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    this.store.closeTicket(ticketId, interaction.user.id);
    await interaction.channel.permissionOverwrites.edit(ticket.userId, { SendMessages: false }, {
      reason: `Ticket closed by ${interaction.user.id}`
    });
    await interaction.channel.setName(`closed-${cleanChannelName(interaction.channel.name.replace(/^ticket-/, ''))}`);
    await interaction.message.edit({
      embeds: [EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(COLORS.danger)
        .setFooter({ text: `Ticket ${ticket.id.slice(0, 8)} • Closed by ${interaction.user.tag}` })],
      components: []
    });
    await interaction.editReply({ content: 'Ticket closed and archived. Staff can keep or remove this channel.' });
    await this.updatePresence();
  }

  async reviewApplication(interaction, applicationId, status) {
    if (!this.isStaff(interaction)) return this.staffOnly(interaction);
    const application = this.store.review('applications', applicationId, status, interaction.user.id);
    if (!application) return this.alreadyReviewed(interaction);
    if (status === 'approved' && this.config.staffRoleId) {
      const member = await interaction.guild.members.fetch(application.userId).catch(() => null);
      if (member) await member.roles.add(this.config.staffRoleId, `Staff application approved by ${interaction.user.id}`);
    }
    await this.finishReview(interaction, status, application.userId, 'application');
  }

  async reviewLeave(interaction, leaveId, status) {
    if (!this.isStaff(interaction)) return this.staffOnly(interaction);
    const leave = this.store.review('leaves', leaveId, status, interaction.user.id);
    if (!leave) return this.alreadyReviewed(interaction);
    await this.finishReview(interaction, status, leave.userId, 'leave request');
  }

  async claimDrop(interaction, dropId) {
    if (interaction.user.bot) {
      await interaction.reply({ content: 'Bot accounts cannot claim drops.', flags: MessageFlags.Ephemeral });
      return;
    }
    const drop = this.store.claimDrop(dropId, interaction.user.id);
    if (!drop) {
      await interaction.reply({ content: 'This reward has already been claimed.', flags: MessageFlags.Ephemeral });
      return;
    }
    const original = interaction.message.embeds[0];
    await interaction.update({
      embeds: [EmbedBuilder.from(original)
        .setColor(COLORS.success)
        .setDescription(`## ${truncate(drop.prize, 200)}\n\nClaimed by <@${interaction.user.id}>`)
        .spliceFields(0, 1, { name: 'Status', value: '🔒 Claimed', inline: true })
        .setFooter({ text: `Winner: ${interaction.user.tag} • +250 Valax coins` })],
      components: []
    });
  }

  textRow(id, label, style, minLength, maxLength, required = true) {
    return new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style)
        .setMinLength(Math.max(0, minLength))
        .setMaxLength(maxLength)
        .setRequired(required)
    );
  }

  reviewRow(type, id) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`community:${type}:approve:${id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`community:${type}:reject:${id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
    );
  }

  async resolveTextChannel(channelId, fallback = null) {
    if (!channelId) return fallback?.isTextBased?.() ? fallback : null;
    const channel = this.client.channels.cache.get(channelId) || await this.client.channels.fetch(channelId).catch(() => null);
    return channel?.isTextBased?.() ? channel : null;
  }

  async staffOnly(interaction) {
    await interaction.reply({ content: 'Only staff can review this request.', flags: MessageFlags.Ephemeral });
  }

  async alreadyReviewed(interaction) {
    await interaction.reply({ content: 'This request has already been reviewed.', flags: MessageFlags.Ephemeral });
  }

  async finishReview(interaction, status, userId, label) {
    const color = status === 'approved' ? COLORS.success : COLORS.danger;
    await interaction.update({
      embeds: [EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(color)
        .setFooter({ text: `${label} • ${status} by ${interaction.user.tag}` })],
      components: []
    });
    const user = await this.client.users.fetch(userId).catch(() => null);
    if (user) await user.send(`Your Valax ${label} was **${status}**.`).catch(() => {});
  }
}

module.exports = { CommunityService, cleanChannelName, formatDuration, truncate };
