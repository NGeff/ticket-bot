import { logger } from '../utils/logger.js';
import { RateLimiter, createTranscript } from '../utils/logger.js';
import { 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ActionRowBuilder, 
  EmbedBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  StringSelectMenuBuilder,
  ChannelType 
} from 'discord.js';

const rateLimiter = new RateLimiter();

export default {
  name: 'interactionCreate',
  async execute(client, interaction) {
    try {
      if (interaction.isCommand()) {
        await handleCommand(client, interaction);
      } else if (interaction.isButton()) {
        await handleButton(client, interaction);
      } else if (interaction.isStringSelectMenu()) {
        await handleSelectMenu(client, interaction);
      } else if (interaction.isModalSubmit()) {
        await handleModal(client, interaction);
      }
    } catch (error) {
      logger.error('INTERACTION', 'Erro não tratado na interação', { 
        error: error.message,
        stack: error.stack,
        type: interaction.type,
        customId: interaction.customId || interaction.commandName
      });
      
      const errorReply = { 
        content: `❌ **Erro inesperado:**\n\`\`\`${error.message}\`\`\``, 
        ephemeral: true 
      };
      
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorReply);
        } else {
          await interaction.reply(errorReply);
        }
      } catch (replyError) {
        logger.error('INTERACTION', 'Falha ao enviar mensagem de erro', { 
          error: replyError.message 
        });
      }
    }
  }
};

async function handleCommand(client, interaction) {
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn('COMMAND', `Comando não encontrado: ${interaction.commandName}`);
    return;
  }
  
  const config = await client.db.getGuildConfig(interaction.guildId);
  
  if (!config.useSlashCommands) {
    return interaction.reply({ 
      content: '❌ Comandos slash estão desabilitados. Use o prefix configurado.', 
      ephemeral: true 
    });
  }
  
  const rateLimitKey = `${interaction.guildId}:${interaction.user.id}:${interaction.commandName}`;
  
  if (!rateLimiter.check(rateLimitKey, 5, 60000)) {
    return interaction.reply({ 
      content: '⏱️ Você está fazendo isso muito rápido! Aguarde um momento.', 
      ephemeral: true 
    });
  }
  
  logger.info('COMMAND', `Executando: ${interaction.commandName}`, {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    user: interaction.user.tag
  });
  
  try {
    await command.execute(interaction, client);
  } catch (error) {
    logger.error('COMMAND', `Erro em ${interaction.commandName}`, { 
      error: error.message,
      stack: error.stack,
      guildId: interaction.guildId,
      userId: interaction.user.id
    });
    
    const errorMsg = `❌ **Erro ao executar comando:**\n\`\`\`${error.message}\`\`\``;
    
    const reply = { content: errorMsg, ephemeral: true };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

async function handleButton(client, interaction) {
  const customId = interaction.customId;
  
  logger.info('BUTTON', `Botão clicado: ${customId}`, {
    guildId: interaction.guildId,
    userId: interaction.user.id
  });
  
  try {
    if (customId === 'panel_create_ticket') {
      const config = await client.db.getGuildConfig(interaction.guildId);
      
      const userTickets = await client.db.getAllTickets(interaction.guildId, { 
        authorId: interaction.user.id, 
        status: 'open' 
      });
      
      if (userTickets.length >= config.maxTicketsPerUser) {
        return interaction.reply({ 
          content: `❌ Você já possui **${userTickets.length}** ticket(s) aberto(s). Limite: **${config.maxTicketsPerUser}**\n\n💡 Feche um ticket antes de abrir outro.`, 
          ephemeral: true 
        });
      }
      
      if (config.templates.length > 1) {
        const selectMenu = new StringSelectMenuBuilder()
          .setCustomId('ticket_template_select')
          .setPlaceholder('🎫 Selecione o tipo de ticket')
          .addOptions(config.templates.map((template, index) => ({
            label: template.name,
            description: template.description,
            value: String(index),
            emoji: template.emoji
          })));
        
        const row = new ActionRowBuilder().addComponents(selectMenu);
        return interaction.reply({ 
          content: '**📋 Escolha o tipo do seu ticket:**', 
          components: [row], 
          ephemeral: true 
        });
      }
      
      const modal = new ModalBuilder()
        .setCustomId('ticket_modal:0')
        .setTitle('🎫 Criar Ticket');
      
      const reasonInput = new TextInputBuilder()
        .setCustomId('ticket_reason')
        .setLabel('📝 Motivo do ticket')
        .setPlaceholder('Descreva brevemente o motivo...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);
      
      const descriptionInput = new TextInputBuilder()
        .setCustomId('ticket_description')
        .setLabel('📄 Descrição detalhada')
        .setPlaceholder('Explique detalhadamente sua solicitação...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);
      
      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(descriptionInput)
      );
      
      await interaction.showModal(modal);
    }
    
    else if (customId === 'ticket_close') {
      const ticket = await client.db.getTicketByChannel(interaction.guildId, interaction.channelId);
      if (!ticket) {
        return interaction.reply({ 
          content: '❌ Ticket não encontrado no banco de dados.', 
          ephemeral: true 
        });
      }
      
      ticket.status = 'closed';
      ticket.closedAt = new Date().toISOString();
      ticket.closedBy = interaction.user.id;
      ticket.closeReason = 'Fechado via botão';
      
      await client.db.saveTicket(interaction.guildId, ticket);
      
      const config = await client.db.getGuildConfig(interaction.guildId);
      
      if (config.features.transcripts) {
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const transcript = await createTranscript(Array.from(messages.values()));
        await client.db.saveTranscript(interaction.guildId, ticket.ticketId, transcript);
        
        if (config.logChannelId) {
          const logChannel = await interaction.guild.channels.fetch(config.logChannelId).catch(() => null);
          if (logChannel) {
            const embed = new EmbedBuilder()
              .setTitle('🔒 Ticket Fechado')
              .setColor(0xFF0000)
              .addFields(
                { name: '🆔 ID', value: ticket.ticketId, inline: true },
                { name: '👤 Autor', value: `<@${ticket.authorId}>`, inline: true },
                { name: '🔒 Fechado por', value: `<@${interaction.user.id}>`, inline: true },
                { name: '🏷️ Tipo', value: ticket.type || 'Geral', inline: true },
                { name: '📝 Motivo', value: ticket.reason || 'N/A' }
              )
              .setTimestamp();
            
            await logChannel.send({ embeds: [embed] });
          }
        }
      }
      
      await interaction.reply('🔒 **Ticket fechado!** Este canal será deletado em 5 segundos...');
      
      logger.info('TICKET', `Ticket ${ticket.ticketId} fechado`, { 
        guildId: interaction.guildId, 
        userId: interaction.user.id 
      });
      
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }
    
    else if (customId === 'ticket_claim') {
      const ticket = await client.db.getTicketByChannel(interaction.guildId, interaction.channelId);
      if (!ticket) {
        return interaction.reply({ 
          content: '❌ Ticket não encontrado.', 
          ephemeral: true 
        });
      }
      
      if (ticket.claimedBy) {
        return interaction.reply({ 
          content: `⚠️ Este ticket já foi assumido por <@${ticket.claimedBy}>`, 
          ephemeral: true 
        });
      }
      
      ticket.claimedBy = interaction.user.id;
      ticket.claimedAt = new Date().toISOString();
      await client.db.saveTicket(interaction.guildId, ticket);
      
      await interaction.reply(`👤 **${interaction.user.tag}** assumiu este ticket!`);
      logger.info('TICKET', `Ticket ${ticket.ticketId} assumido`, { 
        guildId: interaction.guildId, 
        userId: interaction.user.id 
      });
    }
    
  } catch (error) {
    logger.error('BUTTON', `Erro no botão ${customId}`, { 
      error: error.message,
      stack: error.stack,
      guildId: interaction.guildId,
      userId: interaction.user.id
    });
    
    const reply = { content: `❌ Erro: ${error.message}`, ephemeral: true };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

async function handleSelectMenu(client, interaction) {
  logger.info('SELECT_MENU', `Menu selecionado: ${interaction.customId}`, {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    values: interaction.values
  });
  
  try {
    if (interaction.customId === 'ticket_template_select') {
      const templateIndex = parseInt(interaction.values[0]);
      const config = await client.db.getGuildConfig(interaction.guildId);
      const template = config.templates[templateIndex];
      
      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal:${templateIndex}`)
        .setTitle(`${template.emoji} ${template.name}`);
      
      const reasonInput = new TextInputBuilder()
        .setCustomId('ticket_reason')
        .setLabel('📝 Motivo resumido')
        .setPlaceholder('Descreva brevemente...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);
      
      const descriptionInput = new TextInputBuilder()
        .setCustomId('ticket_description')
        .setLabel('📄 Descrição detalhada')
        .setPlaceholder('Explique detalhadamente sua solicitação...')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);
      
      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput),
        new ActionRowBuilder().addComponents(descriptionInput)
      );
      
      await interaction.showModal(modal);
    }
  } catch (error) {
    logger.error('SELECT_MENU', `Erro no menu ${interaction.customId}`, { 
      error: error.message,
      stack: error.stack
    });
    
    const reply = { content: `❌ Erro: ${error.message}`, ephemeral: true };
    
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(reply).catch(() => {});
    } else {
      await interaction.reply(reply).catch(() => {});
    }
  }
}

async function handleModal(client, interaction) {
  logger.info('MODAL', `Modal enviado: ${interaction.customId}`, {
    guildId: interaction.guildId,
    userId: interaction.user.id
  });
  
  if (interaction.customId.startsWith('ticket_modal:')) {
    try {
      const templateIndex = parseInt(interaction.customId.split(':')[1]);
      const reason = interaction.fields.getTextInputValue('ticket_reason');
      const description = interaction.fields.getTextInputValue('ticket_description');
      
      const config = await client.db.getGuildConfig(interaction.guildId);
      const template = config.templates[templateIndex] || { name: 'Geral', emoji: '🎫', value: 'general' };
      
      if (!config.ticketCategoryId) {
        return interaction.reply({ 
          content: '❌ **Categoria não configurada!**\n\n💡 Um administrador precisa usar `/setup` primeiro.', 
          ephemeral: true 
        });
      }
      
      // Defer reply logo no início
      await interaction.deferReply({ ephemeral: true });
      
      const ticketId = await client.db.generateTicketId(interaction.guildId);
      
      const ticketData = {
        ticketId,
        guildId: interaction.guildId,
        authorId: interaction.user.id,
        channelId: null,
        status: 'open',
        type: template.value || template.name,
        reason,
        description,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        messages: []
      };
      
      const permissions = [
        { id: interaction.guild.id, deny: ['ViewChannel'] },
        { id: interaction.user.id, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles'] }
      ];
      
      [...config.staffRoles, ...config.supportRoles, ...config.adminRoles].forEach(roleId => {
        permissions.push({ 
          id: roleId, 
          allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'ManageMessages', 'AttachFiles'] 
        });
      });
      
      const channel = await interaction.guild.channels.create({
        name: `${template.emoji}-${ticketId.toLowerCase()}`,
        type: ChannelType.GuildText,
        parent: config.ticketCategoryId,
        permissionOverwrites: permissions,
        topic: `🎫 ${ticketId} | 👤 ${interaction.user.tag} | 🏷️ ${template.name}`
      });
      
      ticketData.channelId = channel.id;
      await client.db.saveTicket(interaction.guildId, ticketData);
      
      const embed = new EmbedBuilder()
        .setTitle(`${template.emoji} ${template.name}`)
        .setDescription(`👋 Bem-vindo, <@${interaction.user.id}>!\n\nDescreva seu problema e nossa equipe responderá em breve.`)
        .addFields(
          { name: '📝 Motivo', value: reason },
          { name: '📄 Descrição', value: description },
          { name: '🆔 ID', value: `\`${ticketId}\``, inline: true },
          { name: '📅 Criado', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true }
        )
        .setColor(0x00FF00)
        .setFooter({ text: `Ticket criado por ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
        .setTimestamp();
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_close')
          .setLabel('Fechar')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🔒'),
        new ButtonBuilder()
          .setCustomId('ticket_claim')
          .setLabel('Assumir')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('👤')
      );
      
      let mentions = `<@${interaction.user.id}>`;
      if (config.features.pingStaff) {
        const roleMentions = [...config.staffRoles, ...config.supportRoles]
          .map(r => `<@&${r}>`)
          .join(' ');
        if (roleMentions) mentions += ` ${roleMentions}`;
      }
      
      await channel.send({ content: mentions, embeds: [embed], components: [row] });
      
      await interaction.editReply({ 
        content: `✅ **Ticket criado com sucesso!**\n\n🎫 ${channel}`
      });
      
      logger.info('TICKET', `Ticket ${ticketId} criado`, { 
        guildId: interaction.guildId, 
        userId: interaction.user.id,
        type: template.name,
        channelId: channel.id
      });
      
    } catch (error) {
      logger.error('MODAL', 'Erro ao criar ticket', { 
        error: error.message,
        stack: error.stack,
        guildId: interaction.guildId,
        userId: interaction.user.id
      });
      
      const errorReply = { 
        content: `❌ **Erro ao criar ticket:**\n\`\`\`${error.message}\`\`\`` 
      };
      
      if (interaction.deferred) {
        await interaction.editReply(errorReply).catch(() => {});
      } else {
        await interaction.reply({ ...errorReply, ephemeral: true }).catch(() => {});
      }
    }
  }
}