import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '../..');
const LOGS_DIR = join(ROOT_DIR, 'logs');

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL || 'INFO'];

class Logger {
  constructor() {
    this.colors = {
      DEBUG: '\x1b[36m',
      INFO: '\x1b[32m',
      WARN: '\x1b[33m',
      ERROR: '\x1b[31m',
      RESET: '\x1b[0m'
    };
  }

  getTimestamp() {
    return new Date().toISOString();
  }

  getLogFile() {
    const date = this.getTimestamp().split('T')[0];
    return join(LOGS_DIR, `${date}.log`);
  }

  ensureLogsDir() {
    if (!existsSync(LOGS_DIR)) mkdirSync(LOGS_DIR, { recursive: true });
  }

  format(level, context, message, metadata = {}) {
    const timestamp = this.getTimestamp();
    const meta = Object.keys(metadata).length > 0 ? ` | ${JSON.stringify(metadata)}` : '';
    return `[${timestamp}] [${level}] [${context}] ${message}${meta}`;
  }

  write(level, context, message, metadata = {}) {
    if (LOG_LEVELS[level] < CURRENT_LEVEL) return;
    
    this.ensureLogsDir();
    
    const formatted = this.format(level, context, message, metadata);
    const logFile = this.getLogFile();
    
    try {
      appendFileSync(logFile, formatted + '\n', 'utf-8');
    } catch (error) {
      console.error('❌ Falha ao escrever log:', error);
    }
    
    const color = this.colors[level] || '';
    console.log(`${color}${formatted}${this.colors.RESET}`);
  }

  debug(context, message, metadata) {
    this.write('DEBUG', context, message, metadata);
  }

  info(context, message, metadata) {
    this.write('INFO', context, message, metadata);
  }

  warn(context, message, metadata) {
    this.write('WARN', context, message, metadata);
  }

  error(context, message, metadata) {
    this.write('ERROR', context, message, metadata);
  }
}

export const logger = new Logger();

export class I18n {
  constructor() {
    this.cache = new Map();
    this.config = null;
    this.loadConfig();
  }

  loadConfig() {
    try {
      const configPath = join(ROOT_DIR, 'config.json');
      this.config = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (error) {
      logger.error('I18N', 'Falha ao carregar config.json', { error: error.message });
      this.config = { messages: { 'pt-BR': {} } };
    }
  }

  async translate(key, guildId, replacements = {}, db) {
    try {
      const guildConfig = await db.getGuildConfig(guildId);
      const language = guildConfig.language || 'pt-BR';
      
      if (guildConfig.customMessages?.[key]) {
        return this.applyReplacements(guildConfig.customMessages[key], replacements);
      }
      
      const message = this.config.messages[language]?.[key] 
                   || this.config.messages['pt-BR']?.[key] 
                   || key;
      
      return this.applyReplacements(message, replacements);
    } catch (error) {
      logger.error('I18N', `Falha ao traduzir chave: ${key}`, { error: error.message });
      return key;
    }
  }

  applyReplacements(message, replacements) {
    let result = message;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
  }

  async translateText(text, targetLang, db) {
    const cacheKey = `${targetLang}:${text}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    
    try {
      const cached = await db.getTranslationCache(targetLang, text);
      if (cached) {
        this.cache.set(cacheKey, cached);
        return cached;
      }
      
      const params = new URLSearchParams({
        client: 'gtx',
        sl: 'auto',
        tl: targetLang,
        dt: 't',
        q: text
      });
      
      const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`);
      
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const data = await response.json();
      const translated = data[0].map(item => item[0]).join('');
      
      await db.setTranslationCache(targetLang, text, translated);
      this.cache.set(cacheKey, translated);
      
      return translated;
    } catch (error) {
      logger.error('I18N', `Falha na tradução: "${text}"`, { error: error.message });
      return text;
    }
  }
}

export class RateLimiter {
  constructor() {
    this.limits = new Map();
    this.cleanup();
  }

  check(key, maxAttempts = 5, windowMs = 60000) {
    const now = Date.now();
    const userLimits = this.limits.get(key) || [];
    const recentAttempts = userLimits.filter(time => now - time < windowMs);
    
    if (recentAttempts.length >= maxAttempts) {
      return false;
    }
    
    recentAttempts.push(now);
    this.limits.set(key, recentAttempts);
    return true;
  }

  reset(key) {
    this.limits.delete(key);
  }

  cleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, attempts] of this.limits.entries()) {
        const recent = attempts.filter(time => now - time < 3600000);
        if (recent.length === 0) {
          this.limits.delete(key);
        } else {
          this.limits.set(key, recent);
        }
      }
    }, 600000);
  }
}

export function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export function validateConfig(config) {
  const required = ['guildId', 'language', 'prefix'];
  const missing = required.filter(key => !config[key]);
  
  if (missing.length > 0) {
    throw new Error(`Configuração inválida. Faltando: ${missing.join(', ')}`);
  }
  
  return true;
}

export function sanitizeInput(input, maxLength = 1000) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .substring(0, maxLength)
    .replace(/[<>@#]/g, '');
}

export async function createTranscript(messages) {
  const text = messages
    .reverse()
    .map(m => `[${m.createdAt.toISOString()}] ${m.author.tag}: ${m.content}`)
    .join('\n');
  
  const data = messages.map(m => ({
    id: m.id,
    author: { id: m.author.id, tag: m.author.tag },
    content: m.content,
    timestamp: m.createdAt.toISOString(),
    attachments: m.attachments.map(a => a.url)
  }));
  
  return { text, data };
}