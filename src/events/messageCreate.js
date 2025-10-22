import { EmbedBuilder } from 'discord.js';
import { logger } from '../utils/logger.js';

export default {
  name: 'messageCreate',
  async execute(client, message) {
    if (message.author.bot || !message.guild) return;
    
    try {
      const ticket = await client.db.getTicketByChannel(message.guildId, message.channelId);
      if (ticket && ticket.status === 'open') {
        ticket.lastActivityAt = new Date().toISOString();
        await client.db.saveTicket(message.guildId, ticket);
      }
      
      const config = await client.db.getGuildConfig(message.guildId);
      
      if (!config.usePrefixCommands) return;
      
      const prefix = config.prefix || '/';
      
      if (!message.content.startsWith(prefix)) return;
      
      const args = message.content.slice(prefix.length).trim().split(/ +/);
      const commandName = args.shift().toLowerCase();
      
      logger.info('PREFIX_COMMAND', `Comando prefix: ${commandName}`, {
        guildId: message.guildId,
        userId: message.author.id,
        user: message.author.tag
      });
      
      if (commandName === 'ping') {
        await message.reply(`🏓 **Pong!**\n⏱️ Latência: **${client.ws.ping}ms**`);
      }
      
      else if (commandName === 'help') {
        const embed = new EmbedBuilder()
          .setTitle('📚 Ajuda - Sistema de Tickets')
          .setDescription('Use os comandos abaixo para gerenciar tickets:')
          .addFields(
            { name: '🎫 Tickets', value: '`/ticket create` - Criar ticket\n`/ticket close` - Fechar\n`/ticket stats` - Estatísticas' },
            { name: '⚙️ Configuração', value: '`/config categoria` - Definir categoria\n`/config ver` - Ver configurações\n`/setup` - Setup rápido' },
            { name: '📋 Outros', value: '`/panel` - Criar painel\n`/actions` - Ações em massa' }
          )
          .setColor(0x0099FF)
          .setFooter({ text: `Prefix: ${prefix} | Use /help para mais detalhes` });
        
        await message.reply({ embeds: [embed] });
      }
      
    } catch (error) {
      logger.error('MESSAGE_CREATE', 'Erro ao processar mensagem', {
        error: error.message,
        stack: error.stack,
        guildId: message.guildId,
        userId: message.author.id
      });
    }
  }
};