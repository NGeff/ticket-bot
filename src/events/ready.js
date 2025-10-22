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
  name: 'ready',
  once: true,
  execute(client) {
    logger.info('READY', `✅ Bot online como ${client.user.tag}`);
    logger.info('READY', `📊 ${client.guilds.cache.size} servidor(es) | ${client.users.cache.size} usuário(s)`);
    
    client.user.setPresence({
      activities: [{ name: '🎫 Tickets | /help', type: 3 }],
      status: 'online'
    });
    
    startAutoClose(client);
    startCacheCleanup(client);
  }
};

function startAutoClose(client) {
  setInterval(async () => {
    const guilds = client.guilds.cache.map(g => g.id);
    
    for (const guildId of guilds) {
      try {
        const config = await client.db.getGuildConfig(guildId);
        
        if (!config.features.autoClose) continue;
        
        const tickets = await client.db.getAllTickets(guildId, { status: 'open' });
        const now = Date.now();
        
        for (const ticket of tickets) {
          const lastActivity = new Date(ticket.lastActivityAt || ticket.createdAt).getTime();
          const daysSince = (now - lastActivity) / (1000 * 60 * 60 * 24);
          
          if (daysSince >= config.autoCloseDays) {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) continue;
            
            const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
            if (!channel) continue;
            
            ticket.status = 'closed';
            ticket.closedAt = new Date().toISOString();
            ticket.closedBy = 'AUTO_CLOSE';
            ticket.closeReason = `Inatividade (${Math.floor(daysSince)} dias)`;
            
            await client.db.saveTicket(guildId, ticket);
            
            await channel.send('🔒 **Ticket fechado automaticamente por inatividade**');
            setTimeout(() => channel.delete().catch(() => {}), 5000);
            
            logger.info('AUTO_CLOSE', `Ticket ${ticket.ticketId} fechado`, { guildId });
          }
        }
      } catch (error) {
        logger.error('AUTO_CLOSE', `Erro no guild ${guildId}`, { error: error.message });
      }
    }
  }, 3600000);
}

function startCacheCleanup(client) {
  setInterval(() => {
    const before = client.db.cache.size;
    client.db.cache.clear();
    logger.debug('CACHE', `Limpeza realizada: ${before} → 0 itens`);
  }, 1800000);
}