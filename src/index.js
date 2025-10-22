import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes, Collection } from 'discord.js';
import { readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger, I18n } from './utils/logger.js';
import { Database } from './utils/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REQUIRED_ENV = ['BOT_TOKEN', 'CLIENT_ID', 'OWNER_ID'];
const missing = REQUIRED_ENV.filter(v => !process.env[v]);

if (missing.length > 0) {
  console.error(`❌ Variáveis de ambiente faltando: ${missing.join(', ')}`);
  process.exit(1);
}

export const db = new Database();
export const i18n = new I18n();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.DirectMessages
  ]
});

client.commands = new Collection();
client.db = db;
client.i18n = i18n;

async function loadCommands() {
  const commandFiles = readdirSync(join(__dirname, 'commands')).filter(f => f.endsWith('.js'));
  
  for (const file of commandFiles) {
    try {
      const commandModule = await import(`./commands/${file}`);
      
      if (commandModule.default) {
        if (commandModule.default.data && commandModule.default.execute) {
          client.commands.set(commandModule.default.data.name, commandModule.default);
          logger.debug('LOADER', `Comando carregado: ${commandModule.default.data.name}`);
        } else if (typeof commandModule.default === 'object') {
          for (const [key, command] of Object.entries(commandModule.default)) {
            if (command.data && command.execute) {
              client.commands.set(command.data.name, command);
              logger.debug('LOADER', `Comando carregado: ${command.data.name}`);
            }
          }
        }
      }
      
      for (const [key, value] of Object.entries(commandModule)) {
        if (key !== 'default' && value.data && value.execute) {
          client.commands.set(value.data.name, value);
          logger.debug('LOADER', `Comando carregado: ${value.data.name}`);
        }
      }
    } catch (error) {
      logger.error('LOADER', `Erro ao carregar comando ${file}`, { error: error.message });
    }
  }
  
  logger.info('LOADER', `${client.commands.size} comandos carregados`);
}

async function loadEvents() {
  const eventFiles = readdirSync(join(__dirname, 'events')).filter(f => f.endsWith('.js'));
  
  for (const file of eventFiles) {
    try {
      const event = await import(`./events/${file}`);
      const eventName = file.replace('.js', '');
      
      if (event.default?.execute) {
        if (event.default.once) {
          client.once(eventName, (...args) => event.default.execute(client, ...args));
        } else {
          client.on(eventName, (...args) => event.default.execute(client, ...args));
        }
        logger.debug('LOADER', `Evento carregado: ${eventName}`);
      }
    } catch (error) {
      logger.error('LOADER', `Erro ao carregar evento ${file}`, { error: error.message });
    }
  }
  
  logger.info('LOADER', `${eventFiles.length} eventos carregados`);
}

async function registerCommands() {
  const rest = new REST().setToken(process.env.BOT_TOKEN);
  const commands = Array.from(client.commands.values()).map(cmd => cmd.data.toJSON());
  
  try {
    logger.info('DEPLOY', 'Registrando comandos slash...');
    
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    
    logger.info('DEPLOY', `${commands.length} comandos registrados com sucesso`);
  } catch (error) {
    logger.error('DEPLOY', 'Falha ao registrar comandos', { error: error.message });
    throw error;
  }
}

async function startBot() {
  try {
    logger.info('STARTUP', '🚀 Iniciando bot...');
    
    await db.ensureDirectories();
    await loadCommands();
    await loadEvents();
    
    await client.login(process.env.BOT_TOKEN);
    
    await registerCommands();
    
  } catch (error) {
    logger.error('STARTUP', 'Falha ao iniciar bot', { error: error.stack });
    process.exit(1);
  }
}

process.on('unhandledRejection', error => {
  logger.error('PROCESS', 'Promise rejection não tratada', { error: error.stack });
});

process.on('uncaughtException', error => {
  logger.error('PROCESS', 'Exceção não capturada', { error: error.stack });
  process.exit(1);
});

process.on('SIGINT', () => {
  logger.info('SHUTDOWN', '⏹️  Desligamento gracioso (SIGINT)');
  client.destroy();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('SHUTDOWN', '⏹️  Desligamento gracioso (SIGTERM)');
  client.destroy();
  process.exit(0);
});

startBot();