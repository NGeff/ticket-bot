import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';

export const help = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('📚 Ver ajuda e comandos disponíveis'),
  
  async execute(interaction, client) {
    const config = await client.db.getGuildConfig(interaction.guildId);
    const prefix = config.prefix || '/';
    
    const embed = new EmbedBuilder()
      .setTitle('📚 Sistema de Tickets - Ajuda')
      .setDescription('**Bem-vindo ao sistema de tickets!** Aqui estão todos os comandos disponíveis:')
      .setColor(0x0099FF)
      .addFields(
        {
          name: '🎫 Comandos de Tickets',
          value: '```\n' +
                 '/ticket create      - Criar um ticket\n' +
                 '/ticket close       - Fechar ticket atual\n' +
                 '/ticket reopen      - Reabrir ticket fechado\n' +
                 '/ticket claim       - Assumir ticket\n' +
                 '/ticket unclaim     - Liberar ticket\n' +
                 '/ticket add         - Adicionar usuário\n' +
                 '/ticket remove      - Remover usuário\n' +
                 '/ticket transfer    - Transferir categoria\n' +
                 '/ticket stats       - Ver estatísticas\n' +
                 '/ticket list        - Listar tickets\n' +
                 '/ticket info        - Info do ticket\n' +
                 '```'
        },
        {
          name: '⚙️ Configuração (Admin)',
          value: '```\n' +
                 '/config categoria   - Definir categoria\n' +
                 '/config logs        - Definir canal logs\n' +
                 '/config idioma      - Alterar idioma\n' +
                 '/config comandos    - Slash/Prefix\n' +
                 '/config prefix      - Mudar prefix\n' +
                 '/config cargo-*     - Gerenciar cargos\n' +
                 '/config max-tickets - Limite usuário\n' +
                 '/config ver         - Ver configurações\n' +
                 '```'
        },
        {
          name: '🚀 Utilitários (Admin)',
          value: '```\n' +
                 '/setup              - Setup rápido\n' +
                 '/panel              - Criar painel\n' +
                 '/actions            - Ações em massa\n' +
                 '/ping               - Testar latência\n' +
                 '/help               - Esta mensagem\n' +
                 '```'
        },
        {
          name: '💡 Dicas',
          value: '• Use o **painel de tickets** para criar tickets facilmente\n' +
                 '• Administradores podem configurar tudo com `/config`\n' +
                 '• Use `/ticket stats` para ver estatísticas completas'
        }
      )
      .setFooter({ 
        text: `Prefix: ${prefix} | ${config.useSlashCommands ? '✅' : '❌'} Slash | ${config.usePrefixCommands ? '✅' : '❌'} Prefix`,
        iconURL: interaction.client.user.displayAvatarURL()
      })
      .setTimestamp();
    
    if (config.usePrefixCommands) {
      embed.addFields({
        name: '⌨️ Comandos com Prefix',
        value: `Você também pode usar **${prefix}** antes dos comandos!\nExemplo: \`${prefix}ticket stats\`, \`${prefix}help\`, \`${prefix}ping\``
      });
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};

export const ping = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('🏓 Verificar latência do bot'),
  
  async execute(interaction, client) {
    const sent = await interaction.reply({ 
      content: '🏓 Calculando latência...', 
      fetchReply: true,
      ephemeral: true 
    });
    
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    const wsLatency = client.ws.ping;
    
    const embed = new EmbedBuilder()
      .setTitle('🏓 Pong!')
      .setColor(wsLatency < 100 ? 0x00FF00 : wsLatency < 200 ? 0xFFFF00 : 0xFF0000)
      .addFields(
        { name: '📡 Latência da API', value: `\`${latency}ms\``, inline: true },
        { name: '💓 WebSocket', value: `\`${wsLatency}ms\``, inline: true },
        { name: '📊 Status', value: wsLatency < 100 ? '✅ Excelente' : wsLatency < 200 ? '⚠️ Bom' : '❌ Lento', inline: true }
      )
      .setFooter({ text: `Uptime: ${formatUptime(client.uptime)}` })
      .setTimestamp();
    
    await interaction.editReply({ content: null, embeds: [embed] });
  }
};

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export default { help, ping };