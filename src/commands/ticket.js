import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { createTranscript, formatDuration } from '../utils/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('🎫 Gerenciar tickets do sistema')
    .addSubcommand(sub => sub.setName('create').setDescription('🆕 Criar um novo ticket'))
    .addSubcommand(sub => sub
      .setName('close')
      .setDescription('🔒 Fechar o ticket atual')
      .addStringOption(opt => opt.setName('motivo').setDescription('Motivo do fechamento'))
    )
    .addSubcommand(sub => sub
      .setName('reopen')
      .setDescription('🔓 Reabrir um ticket fechado')
      .addStringOption(opt => opt.setName('ticket_id').setDescription('ID do ticket (ex: TKT-0001)').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('claim').setDescription('👤 Assumir o ticket atual'))
    .addSubcommand(sub => sub.setName('unclaim').setDescription('🔓 Liberar o ticket atual'))
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('➕ Adicionar usuário ao ticket')
      .addUserOption(opt => opt.setName('usuario').setDescription('Usuário para adicionar').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('➖ Remover usuário do ticket')
      .addUserOption(opt => opt.setName('usuario').setDescription('Usuário para remover').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('transfer')
      .setDescription('📤 Transferir ticket para outra categoria')
      .addChannelOption(opt => opt.setName('categoria').setDescription('Categoria destino').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    )
    .addSubcommand(sub => sub.setName('stats').setDescription('📊 Ver estatísticas de tickets'))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('📋 Listar tickets')
      .addStringOption(opt => opt
        .setName('status')
        .setDescription('Filtrar por status')
        .addChoices(
          { name: '🟢 Abertos', value: 'open' },
          { name: '🔴 Fechados', value: 'closed' }
        )
      )
    )
    .addSubcommand(sub => sub.setName('info').setDescription('ℹ️ Ver informações do ticket atual')),
  
  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();
    const { db, i18n } = client;
    
    if (subcommand === 'create') {
      return interaction.reply({ 
        content: '✅ **Use o painel de tickets para criar!**\n\n💡 Um administrador pode criar um painel com `/panel`', 
        ephemeral: true 
      });
    }
    
    if (subcommand === 'close') {
      const ticket = await db.getTicketByChannel(interaction.guildId, interaction.channelId);
      if (!ticket) {
        return interaction.reply({ content: '❌ Este não é um canal de ticket.', ephemeral: true });
      }
      if (ticket.status === 'closed') {
        return interaction.reply({ content: '❌ Este ticket já está fechado.', ephemeral: true });
      }
      
      const reason = interaction.options.getString('motivo') || 'Sem motivo especificado';
      
      ticket.status = 'closed';
      ticket.closedAt = new Date().toISOString();
      ticket.closedBy = interaction.user.id;
      ticket.closeReason = reason;
      
      await db.saveTicket(interaction.guildId, ticket);
      
      const config = await db.getGuildConfig(interaction.guildId);
      
      if (config.features.transcripts) {
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const transcript = await createTranscript(Array.from(messages.values()));
        await db.saveTranscript(interaction.guildId, ticket.ticketId, transcript);
      }
      
      const duration = Date.now() - new Date(ticket.createdAt).getTime();
      
      const embed = new EmbedBuilder()
        .setTitle('🔒 Ticket Fechado')
        .setDescription(`Este ticket foi fechado e será deletado em 10 segundos.`)
        .addFields(
          { name: '🆔 ID', value: ticket.ticketId, inline: true },
          { name: '⏱️ Duração', value: formatDuration(duration), inline: true },
          { name: '🔒 Fechado por', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📝 Motivo', value: reason }
        )
        .setColor(0xFF0000)
        .setTimestamp();
      
      await interaction.reply({ embeds: [embed] });
      
      logger.info('TICKET', `Ticket ${ticket.ticketId} fechado`, { 
        guildId: interaction.guildId, 
        userId: interaction.user.id 
      });
      
      setTimeout(() => interaction.channel.delete().catch(() => {}), 10000);
    }
    
    if (subcommand === 'reopen') {
      const ticketId = interaction.options.getString('ticket_id').toUpperCase();
      const ticket = await db.getTicket(interaction.guildId, ticketId);
      
      if (!ticket) {
        return interaction.reply({ content: '❌ Ticket não encontrado.', ephemeral: true });
      }
      if (ticket.status !== 'closed') {
        return interaction.reply({ content: '❌ Este ticket não está fechado.', ephemeral: true });
      }
      
      const config = await db.getGuildConfig(interaction.guildId);
      
      const permissions = [
        { id: interaction.guild.id, deny: ['ViewChannel'] },
        { id: ticket.authorId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
      ];
      
      [...config.staffRoles, ...config.supportRoles].forEach(roleId => {
        permissions.push({ id: roleId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] });
      });
      
      const channel = await interaction.guild.channels.create({
        name: `🔓-${ticketId.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        permissionOverwrites: permissions,
        topic: `🔓 Ticket reaberto | ${ticketId} | ${interaction.user.tag}`
      });
      
      ticket.status = 'open';
      ticket.channelId = channel.id;
      ticket.reopenedAt = new Date().toISOString();
      ticket.reopenedBy = interaction.user.id;
      await db.saveTicket(interaction.guildId, ticket);
      
      const embed = new EmbedBuilder()
        .setTitle('🔓 Ticket Reaberto')
        .setDescription(`Ticket **${ticketId}** foi reaberto com sucesso!`)
        .addFields(
          { name: '🆔 ID', value: ticketId, inline: true },
          { name: '👤 Reaberto por', value: `<@${interaction.user.id}>`, inline: true },
          { name: '📅 Data original', value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:R>` }
        )
        .setColor(0x00FF00);
      
      await channel.send({ content: `<@${ticket.authorId}> <@${interaction.user.id}>`, embeds: [embed] });
      
      await interaction.reply({ content: `✅ Ticket reaberto: ${channel}`, ephemeral: true });
      
      logger.info('TICKET', `Ticket ${ticketId} reaberto`, { 
        guildId: interaction.guildId, 
        userId: interaction.user.id 
      });
    }
    
    if (subcommand === 'claim') {
      const ticket = await db.getTicketByChannel(interaction.guildId, interaction.channelId);
      if (!ticket) {
        return interaction.reply({ content: '❌ Este não é um canal de ticket.', ephemeral: true });
      }
      if (ticket.claimedBy) {
        return interaction.reply({ 
          content: `⚠️ Este ticket já foi assumido por <@${ticket.claimedBy}>`, 
          ephemeral: true 
        });
      }
      
      ticket.claimedBy = interaction.user.id;
      ticket.claimedAt = new Date().toISOString();
      await db.saveTicket(interaction.guildId, ticket);
      
      await interaction.reply(`✅ **${interaction.user.tag}** assumiu este ticket!`);
    }
    
    if (subcommand === 'unclaim') {
      const ticket = await db.getTicketByChannel(interaction.guildId, interaction.channelId);
      if (!ticket) {
        return interaction.reply({ content: '❌ Este não é um canal de ticket.', ephemeral: true });
      }
      if (!ticket.claimedBy) {
        return interaction.reply({ content: '⚠️ Este ticket não foi assumido.', ephemeral: true });
      }
      
      const wasClaimedBy = ticket.claimedBy;
      delete ticket.claimedBy;
      delete ticket.claimedAt;
      await db.saveTicket(interaction.guildId, ticket);
      
      await interaction.reply(`🔓 Ticket liberado por **${interaction.user.tag}**`);
    }
    
    if (subcommand === 'add') {
      const user = interaction.options.getUser('usuario');
      
      await interaction.channel.permissionOverwrites.create(user, { 
        ViewChannel: true, 
        SendMessages: true,
        ReadMessageHistory: true
      });
      
      await interaction.reply(`➕ <@${user.id}> foi adicionado ao ticket!`);
    }
    
    if (subcommand === 'remove') {
      const user = interaction.options.getUser('usuario');
      
      await interaction.channel.permissionOverwrites.delete(user);
      
      await interaction.reply(`➖ <@${user.id}> foi removido do ticket!`);
    }
    
    if (subcommand === 'transfer') {
      const category = interaction.options.getChannel('categoria');
      
      await interaction.channel.setParent(category.id);
      
      await interaction.reply(`📤 Ticket transferido para **${category.name}**`);
    }
    
    if (subcommand === 'stats') {
      const stats = await db.getStats(interaction.guildId);
      
      const embed = new EmbedBuilder()
        .setTitle('📊 Estatísticas de Tickets')
        .setColor(0x0099FF)
        .addFields(
          { name: '📈 Total', value: `\`${stats.total}\``, inline: true },
          { name: '🟢 Abertos', value: `\`${stats.open}\``, inline: true },
          { name: '🔴 Fechados', value: `\`${stats.closed}\``, inline: true },
          { name: '👤 Assumidos', value: `\`${stats.claimed}\``, inline: true },
          { name: '📅 Hoje', value: `\`${stats.today}\``, inline: true },
          { name: '📆 Esta semana', value: `\`${stats.week}\``, inline: true },
          { name: '⏱️ Tempo médio', value: `\`${stats.avgResponseTime}min\``, inline: true }
        )
        .setTimestamp()
        .setFooter({ text: `Servidor: ${interaction.guild.name}` });
      
      if (Object.keys(stats.byType).length > 0) {
        const typeStats = Object.entries(stats.byType)
          .map(([type, count]) => `**${type}:** ${count}`)
          .join('\n');
        embed.addFields({ name: '🏷️ Por Tipo', value: typeStats });
      }
      
      await interaction.reply({ embeds: [embed] });
    }
    
    if (subcommand === 'list') {
      const status = interaction.options.getString('status');
      const tickets = await db.getAllTickets(interaction.guildId, status ? { status } : {});
      
      if (tickets.length === 0) {
        return interaction.reply({ content: '📋 Nenhum ticket encontrado.', ephemeral: true });
      }
      
      const embed = new EmbedBuilder()
        .setTitle(`📋 Lista de Tickets ${status ? (status === 'open' ? '🟢 Abertos' : '🔴 Fechados') : ''}`)
        .setColor(0x0099FF)
        .setTimestamp();
      
      const ticketList = tickets.slice(0, 15).map(t => {
        const statusEmoji = t.status === 'open' ? '🟢' : '🔴';
        const claimedInfo = t.claimedBy ? ` 👤 <@${t.claimedBy}>` : '';
        const timeAgo = `<t:${Math.floor(new Date(t.createdAt).getTime() / 1000)}:R>`;
        return `${statusEmoji} **${t.ticketId}** - <@${t.authorId}>${claimedInfo} • ${timeAgo}`;
      }).join('\n');
      
      embed.setDescription(ticketList);
      
      if (tickets.length > 15) {
        embed.setFooter({ text: `Mostrando 15 de ${tickets.length} tickets` });
      }
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    if (subcommand === 'info') {
      const ticket = await db.getTicketByChannel(interaction.guildId, interaction.channelId);
      if (!ticket) {
        return interaction.reply({ content: '❌ Este não é um canal de ticket.', ephemeral: true });
      }
      
      const duration = ticket.closedAt 
        ? new Date(ticket.closedAt).getTime() - new Date(ticket.createdAt).getTime()
        : Date.now() - new Date(ticket.createdAt).getTime();
      
      const embed = new EmbedBuilder()
        .setTitle(`ℹ️ ${ticket.ticketId}`)
        .setColor(ticket.status === 'open' ? 0x00FF00 : 0xFF0000)
        .addFields(
          { name: '👤 Autor', value: `<@${ticket.authorId}>`, inline: true },
          { name: '📊 Status', value: ticket.status === 'open' ? '🟢 Aberto' : '🔴 Fechado', inline: true },
          { name: '🏷️ Tipo', value: ticket.type || 'Geral', inline: true },
          { name: '📅 Criado', value: `<t:${Math.floor(new Date(ticket.createdAt).getTime() / 1000)}:F>` },
          { name: '⏱️ Duração', value: formatDuration(duration), inline: true }
        );
      
      if (ticket.reason) {
        embed.addFields({ name: '📝 Motivo', value: ticket.reason });
      }
      
      if (ticket.description) {
        embed.addFields({ name: '📄 Descrição', value: ticket.description.substring(0, 1024) });
      }
      
      if (ticket.claimedBy) {
        embed.addFields({ 
          name: '👤 Assumido por', 
          value: `<@${ticket.claimedBy}> (<t:${Math.floor(new Date(ticket.claimedAt).getTime() / 1000)}:R>)` 
        });
      }
      
      if (ticket.closedBy) {
        embed.addFields(
          { name: '🔒 Fechado por', value: `<@${ticket.closedBy}>`, inline: true },
          { name: '📅 Fechado em', value: `<t:${Math.floor(new Date(ticket.closedAt).getTime() / 1000)}:R>`, inline: true }
        );
        if (ticket.closeReason) {
          embed.addFields({ name: '💬 Motivo', value: ticket.closeReason });
        }
      }
      
      embed.setFooter({ text: `ID: ${ticket.ticketId}` });
      embed.setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
};

export const config = {
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('⚙️ Configurar o sistema de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('categoria')
      .setDescription('📁 Definir categoria dos tickets')
      .addChannelOption(opt => opt.setName('canal').setDescription('Categoria').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('logs')
      .setDescription('📋 Definir canal de logs')
      .addChannelOption(opt => opt.setName('canal').setDescription('Canal de logs').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('idioma')
      .setDescription('🌐 Definir idioma do bot')
      .addStringOption(opt => opt
        .setName('lingua')
        .setDescription('Idioma')
        .addChoices(
          { name: '🇧🇷 Português (BR)', value: 'pt-BR' },
          { name: '🇺🇸 English (US)', value: 'en-US' },
          { name: '🇪🇸 Español (ES)', value: 'es-ES' }
        )
        .setRequired(true)
      )
    )
    .addSubcommand(sub => sub
      .setName('comandos')
      .setDescription('⌨️ Configurar tipo de comandos')
      .addBooleanOption(opt => opt.setName('slash').setDescription('Habilitar comandos slash').setRequired(true))
      .addBooleanOption(opt => opt.setName('prefix').setDescription('Habilitar comandos com prefix'))
    )
    .addSubcommand(sub => sub
      .setName('prefix')
      .setDescription('⌨️ Definir prefix dos comandos')
      .addStringOption(opt => opt.setName('novo_prefix').setDescription('Novo prefix (ex: !, ?, t!)').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('cargo-staff')
      .setDescription('👥 Adicionar cargo de staff')
      .addRoleOption(opt => opt.setName('cargo').setDescription('Cargo').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('cargo-suporte')
      .setDescription('🎧 Adicionar cargo de suporte')
      .addRoleOption(opt => opt.setName('cargo').setDescription('Cargo').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('remover-cargo')
      .setDescription('➖ Remover cargo da configuração')
      .addRoleOption(opt => opt.setName('cargo').setDescription('Cargo').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('max-tickets')
      .setDescription('🎫 Definir máximo de tickets por usuário')
      .addIntegerOption(opt => opt.setName('quantidade').setDescription('Quantidade máxima').setMinValue(1).setMaxValue(10).setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('auto-fechar')
      .setDescription('⏰ Configurar fechamento automático')
      .addBooleanOption(opt => opt.setName('ativar').setDescription('Ativar/Desativar').setRequired(true))
      .addIntegerOption(opt => opt.setName('dias').setDescription('Dias de inatividade').setMinValue(1).setMaxValue(30))
    )
    .addSubcommand(sub => sub
      .setName('transcripts')
      .setDescription('📄 Ativar/Desativar transcripts')
      .addBooleanOption(opt => opt.setName('ativar').setDescription('Ativar/Desativar').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('ping-staff')
      .setDescription('🔔 Ativar/Desativar menção ao staff')
      .addBooleanOption(opt => opt.setName('ativar').setDescription('Ativar/Desativar').setRequired(true))
    )
    .addSubcommand(sub => sub.setName('ver').setDescription('👀 Ver configurações atuais'))
    .addSubcommand(sub => sub.setName('resetar').setDescription('🔄 Resetar todas as configurações')),
  
  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();
    const { db } = client;
    const config = await db.getGuildConfig(interaction.guildId);
    
    if (subcommand === 'categoria') {
      const category = interaction.options.getChannel('canal');
      config.ticketCategoryId = category.id;
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Categoria de tickets definida:** ${category.name}`);
      logger.info('CONFIG', 'Categoria definida', { guildId: interaction.guildId, categoryId: category.id });
    }
    
    else if (subcommand === 'logs') {
      const channel = interaction.options.getChannel('canal');
      config.logChannelId = channel.id;
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Canal de logs definido:** ${channel}`);
      logger.info('CONFIG', 'Canal de logs definido', { guildId: interaction.guildId, channelId: channel.id });
    }
    
    else if (subcommand === 'idioma') {
      const language = interaction.options.getString('lingua');
      config.language = language;
      await db.setGuildConfig(interaction.guildId, config);
      
      const languageNames = { 'pt-BR': '🇧🇷 Português (BR)', 'en-US': '🇺🇸 English (US)', 'es-ES': '🇪🇸 Español (ES)' };
      await interaction.reply(`✅ **Idioma alterado para:** ${languageNames[language]}`);
      logger.info('CONFIG', 'Idioma alterado', { guildId: interaction.guildId, language });
    }
    
    else if (subcommand === 'comandos') {
      const slash = interaction.options.getBoolean('slash');
      const prefix = interaction.options.getBoolean('prefix');
      
      config.useSlashCommands = slash;
      config.usePrefixCommands = prefix !== null ? prefix : config.usePrefixCommands;
      
      await db.setGuildConfig(interaction.guildId, config);
      
      const status = [];
      if (config.useSlashCommands) status.push('✅ Slash');
      if (config.usePrefixCommands) status.push('✅ Prefix');
      if (status.length === 0) status.push('❌ Nenhum habilitado');
      
      await interaction.reply(`⌨️ **Comandos configurados:**\n${status.join('\n')}`);
    }
    
    else if (subcommand === 'prefix') {
      const newPrefix = interaction.options.getString('novo_prefix');
      config.prefix = newPrefix;
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Prefix alterado para:** \`${newPrefix}\``);
      logger.info('CONFIG', 'Prefix alterado', { guildId: interaction.guildId, prefix: newPrefix });
    }
    
    else if (subcommand === 'cargo-staff') {
      const role = interaction.options.getRole('cargo');
      if (config.staffRoles.includes(role.id)) {
        return interaction.reply({ content: '⚠️ Este cargo já está configurado como staff.', ephemeral: true });
      }
      config.staffRoles.push(role.id);
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Cargo de staff adicionado:** ${role}`);
    }
    
    else if (subcommand === 'cargo-suporte') {
      const role = interaction.options.getRole('cargo');
      if (config.supportRoles.includes(role.id)) {
        return interaction.reply({ content: '⚠️ Este cargo já está configurado como suporte.', ephemeral: true });
      }
      config.supportRoles.push(role.id);
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Cargo de suporte adicionado:** ${role}`);
    }
    
    else if (subcommand === 'remover-cargo') {
      const role = interaction.options.getRole('cargo');
      config.staffRoles = config.staffRoles.filter(r => r !== role.id);
      config.supportRoles = config.supportRoles.filter(r => r !== role.id);
      config.adminRoles = config.adminRoles.filter(r => r !== role.id);
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Cargo removido:** ${role}`);
    }
    
    else if (subcommand === 'max-tickets') {
      const quantidade = interaction.options.getInteger('quantidade');
      config.maxTicketsPerUser = quantidade;
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Máximo de tickets por usuário:** \`${quantidade}\``);
    }
    
    else if (subcommand === 'auto-fechar') {
      const ativar = interaction.options.getBoolean('ativar');
      const dias = interaction.options.getInteger('dias');
      config.features.autoClose = ativar;
      if (dias) config.autoCloseDays = dias;
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Fechamento automático** ${ativar ? `ativado (${config.autoCloseDays} dias)` : 'desativado'}`);
    }
    
    else if (subcommand === 'transcripts') {
      const ativar = interaction.options.getBoolean('ativar');
      config.features.transcripts = ativar;
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Transcripts** ${ativar ? 'ativados' : 'desativados'}`);
    }
    
    else if (subcommand === 'ping-staff') {
      const ativar = interaction.options.getBoolean('ativar');
      config.features.pingStaff = ativar;
      await db.setGuildConfig(interaction.guildId, config);
      await interaction.reply(`✅ **Menção ao staff** ${ativar ? 'ativada' : 'desativada'}`);
    }
    
    else if (subcommand === 'ver') {
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Configurações do Servidor')
        .setColor(0x0099FF)
        .addFields(
          { name: '🌐 Idioma', value: config.language || 'pt-BR', inline: true },
          { name: '⌨️ Prefix', value: `\`${config.prefix}\``, inline: true },
          { name: '📁 Categoria', value: config.ticketCategoryId ? `<#${config.ticketCategoryId}>` : '❌ Não definida', inline: true },
          { name: '📋 Logs', value: config.logChannelId ? `<#${config.logChannelId}>` : '❌ Não definido', inline: true },
          { name: '🎫 Max Tickets/Usuário', value: `\`${config.maxTicketsPerUser}\``, inline: true },
          { name: '⌨️ Comandos Slash', value: config.useSlashCommands ? '✅' : '❌', inline: true },
          { name: '⌨️ Comandos Prefix', value: config.usePrefixCommands ? '✅' : '❌', inline: true }
        );
      
      if (config.staffRoles.length > 0) {
        embed.addFields({ 
          name: '👥 Cargos Staff', 
          value: config.staffRoles.map(r => `<@&${r}>`).join(', ') 
        });
      }
      
      if (config.supportRoles.length > 0) {
        embed.addFields({ 
          name: '🎧 Cargos Suporte', 
          value: config.supportRoles.map(r => `<@&${r}>`).join(', ') 
        });
      }
      
      const features = [];
      if (config.features.transcripts) features.push('📄 Transcripts');
      if (config.features.pingStaff) features.push('🔔 Ping Staff');
      if (config.features.autoClose) features.push(`⏰ Auto-fechar (${config.autoCloseDays}d)`);
      if (config.features.stats) features.push('📊 Estatísticas');
      
      if (features.length > 0) {
        embed.addFields({ name: '✨ Recursos Ativos', value: features.join('\n') });
      }
      
      embed.setFooter({ text: `Configurado por ${interaction.user.tag}` });
      embed.setTimestamp();
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
    
    else if (subcommand === 'resetar') {
      await db.setGuildConfig(interaction.guildId, db.getDefaultGuildConfig(interaction.guildId));
      await interaction.reply('✅ **Configurações resetadas para o padrão!**');
      logger.info('CONFIG', 'Configurações resetadas', { guildId: interaction.guildId });
    }
  }
};

export const setup = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('🚀 Configuração inicial rápida do bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  
  async execute(interaction, client) {
    await interaction.deferReply({ ephemeral: true });
    
    try {
      const category = await interaction.guild.channels.create({
        name: '🎫 TICKETS',
        type: ChannelType.GuildCategory
      });
      
      const logChannel = await interaction.guild.channels.create({
        name: '📋-ticket-logs',
        type: ChannelType.GuildText,
        parent: category.id
      });
      
      const config = await client.db.getGuildConfig(interaction.guildId);
      config.ticketCategoryId = category.id;
      config.logChannelId = logChannel.id;
      await client.db.setGuildConfig(interaction.guildId, config);
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Setup Concluído!')
        .setDescription('**Sistema de tickets configurado com sucesso!**')
        .addFields(
          { name: '📁 Categoria', value: category.name },
          { name: '📋 Logs', value: logChannel.toString() },
          { name: '📝 Próximos Passos', value: '```\n1. /config cargo-staff @Staff\n2. /panel (criar painel)\n3. /config ver (ver configurações)\n```' }
        )
        .setColor(0x00FF00)
        .setTimestamp();
      
      await interaction.editReply({ embeds: [embed] });
      
      logger.info('SETUP', 'Setup inicial concluído', { guildId: interaction.guildId });
    } catch (error) {
      logger.error('SETUP', 'Erro no setup', { error: error.message });
      await interaction.editReply({ content: `❌ **Erro no setup:**\n\`\`\`${error.message}\`\`\`` });
    }
  }
};

export const panel = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('📋 Criar painel de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt => opt
      .setName('canal')
      .setDescription('Canal onde criar o painel')
      .addChannelTypes(ChannelType.GuildText)
    ),
  
  async execute(interaction, client) {
    const channel = interaction.options.getChannel('canal') || interaction.channel;
    
    const embed = new EmbedBuilder()
      .setTitle('🎫 Sistema de Tickets')
      .setDescription('**Precisa de ajuda?** Clique no botão abaixo para abrir um ticket de suporte.\n\n📝 Nossa equipe está disponível para ajudá-lo!\n⏱️ Tempo médio de resposta: **Menos de 1 hora**')
      .setColor(0x0099FF)
      .setThumbnail(interaction.guild.iconURL({ dynamic: true }))
      .addFields(
        { name: '🔹 Como funciona?', value: 'Clique no botão e preencha o formulário com suas informações.' },
        { name: '🔹 Suporte disponível', value: 'Nossa equipe responderá o mais rápido possível!' }
      )
      .setFooter({ text: `${interaction.guild.name} - Sistema de Tickets Profissional` })
      .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('panel_create_ticket')
        .setLabel('Criar Ticket')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎫')
    );
    
    await channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: `✅ **Painel criado em** ${channel}!`, ephemeral: true });
    
    logger.info('PANEL', 'Painel criado', { guildId: interaction.guildId, channelId: channel.id });
  }
};

export const actions = {
  data: new SlashCommandBuilder()
    .setName('actions')
    .setDescription('⚡ Ações em massa de tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub.setName('fechar-todos').setDescription('🔒 Fechar todos os tickets abertos'))
    .addSubcommand(sub => sub.setName('deletar-fechados').setDescription('🗑️ Deletar todos os tickets fechados'))
    .addSubcommand(sub => sub
      .setName('limpar-inativos')
      .setDescription('🧹 Fechar tickets inativos')
      .addIntegerOption(opt => opt.setName('dias').setDescription('Dias de inatividade').setMinValue(1).setRequired(true))
    ),
  
  async execute(interaction, client) {
    const subcommand = interaction.options.getSubcommand();
    const { db } = client;
    
    await interaction.deferReply({ ephemeral: true });
    
    if (subcommand === 'fechar-todos') {
      const tickets = await db.getAllTickets(interaction.guildId, { status: 'open' });
      
      if (tickets.length === 0) {
        return interaction.editReply('ℹ️ **Nenhum ticket aberto encontrado.**');
      }
      
      let closed = 0;
      
      for (const ticket of tickets) {
        try {
          const channel = await interaction.guild.channels.fetch(ticket.channelId).catch(() => null);
          
          ticket.status = 'closed';
          ticket.closedAt = new Date().toISOString();
          ticket.closedBy = interaction.user.id;
          ticket.closeReason = 'Fechamento em massa';
          await db.saveTicket(interaction.guildId, ticket);
          
          if (channel) {
            await channel.send('🔒 **Este ticket foi fechado automaticamente** (fechamento em massa)');
            setTimeout(() => channel.delete().catch(() => {}), 3000);
          }
          
          closed++;
        } catch (error) {
          logger.error('ACTIONS', `Falha ao fechar ticket ${ticket.ticketId}`, { error: error.message });
        }
      }
      
      await interaction.editReply(`✅ **${closed} ticket(s) fechado(s) com sucesso!**`);
      logger.info('ACTIONS', 'Todos os tickets fechados', { guildId: interaction.guildId, count: closed });
    }
    
    else if (subcommand === 'deletar-fechados') {
      const tickets = await db.getAllTickets(interaction.guildId, { status: 'closed' });
      
      if (tickets.length === 0) {
        return interaction.editReply('ℹ️ **Nenhum ticket fechado encontrado.**');
      }
      
      let deleted = 0;
      
      for (const ticket of tickets) {
        try {
          await db.deleteTicket(interaction.guildId, ticket.ticketId);
          deleted++;
        } catch (error) {
          logger.error('ACTIONS', `Falha ao deletar ticket ${ticket.ticketId}`, { error: error.message });
        }
      }
      
      await interaction.editReply(`✅ **${deleted} ticket(s) deletado(s) do banco de dados!**`);
      logger.info('ACTIONS', 'Tickets fechados deletados', { guildId: interaction.guildId, count: deleted });
    }
    
    else if (subcommand === 'limpar-inativos') {
      const dias = interaction.options.getInteger('dias');
      const tickets = await db.getAllTickets(interaction.guildId, { status: 'open' });
      
      if (tickets.length === 0) {
        return interaction.editReply('ℹ️ **Nenhum ticket aberto encontrado.**');
      }
      
      let closed = 0;
      const now = Date.now();
      
      for (const ticket of tickets) {
        const lastActivity = new Date(ticket.lastActivityAt || ticket.createdAt).getTime();
        const daysSince = (now - lastActivity) / (1000 * 60 * 60 * 24);
        
        if (daysSince >= dias) {
          try {
            const channel = await interaction.guild.channels.fetch(ticket.channelId).catch(() => null);
            
            ticket.status = 'closed';
            ticket.closedAt = new Date().toISOString();
            ticket.closedBy = interaction.user.id;
            ticket.closeReason = `Inatividade (${Math.floor(daysSince)} dias)`;
            await db.saveTicket(interaction.guildId, ticket);
            
            if (channel) {
              await channel.send(`🔒 **Fechado por inatividade** (${Math.floor(daysSince)} dias sem atividade)`);
              setTimeout(() => channel.delete().catch(() => {}), 3000);
            }
            
            closed++;
          } catch (error) {
            logger.error('ACTIONS', `Falha ao fechar ticket inativo ${ticket.ticketId}`, { error: error.message });
          }
        }
      }
      
      await interaction.editReply(`✅ **${closed} ticket(s) inativo(s) fechado(s)!**\n📊 Critério: **${dias} dias** sem atividade`);
      logger.info('ACTIONS', 'Tickets inativos fechados', { guildId: interaction.guildId, count: closed, days: dias });
    }
  }
};