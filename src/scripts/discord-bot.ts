import { Client, GatewayIntentBits, Partials } from 'discord.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

const execFileAsync = promisify(execFile);
const __dirname = new URL('.', import.meta.url).pathname;

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN is required.');
  process.exit(1);
}

const commandPrefix = (process.env.DISCORD_ONBOARD_PREFIX || '!onboard').trim();
const allowedGuildIds = (process.env.DISCORD_ALLOWED_GUILD_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedChannelIds = (process.env.DISCORD_ALLOWED_CHANNEL_IDS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

interface ChannelConfig {
  slug: string;
}

function parseChannelMap(raw?: string): Record<string, ChannelConfig> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, ChannelConfig>;
    return parsed ?? {};
  } catch (error) {
    console.error('Failed to parse DISCORD_ONBOARD_CHANNELS JSON:', error);
    return {};
  }
}

const channelMap = parseChannelMap(process.env.DISCORD_ONBOARD_CHANNELS);

function isAllowedGuild(guildId?: string | null): boolean {
  if (!guildId) return false;
  if (allowedGuildIds.length === 0) return true;
  return allowedGuildIds.includes(guildId);
}

function isAllowedChannel(channelId: string): boolean {
  if (allowedChannelIds.length === 0) return true;
  return allowedChannelIds.includes(channelId);
}

function parseOnboardMessage(text: string): { slug: string; content: string } | null {
  const pattern = new RegExp(`^${commandPrefix}\\s+(\\S+)\\s*([\\s\\S]*)$`, 'i');
  const match = text.match(pattern);
  if (!match) return null;
  const slug = match[1].trim();
  const content = match[2]?.trim() ?? '';
  if (!slug || !content) return null;
  return { slug, content };
}

async function fetchAttachmentContent(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch attachment (${res.status})`);
  }
  return res.text();
}

async function saveOnboarding(slug: string, content: string): Promise<string> {
  const targetDir = path.resolve(__dirname, '../../.gemini/protocols', slug);
  const targetFile = path.join(targetDir, 'ONBOARDING.md');
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetFile, content, 'utf-8');
  return targetFile;
}

async function runOnboard(slug: string, filePath: string): Promise<void> {
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const cwd = path.resolve(__dirname, '../..');
  await execFileAsync(npmCmd, ['run', 'tool:onboard', '--', slug, filePath], { cwd });
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!isAllowedGuild(message.guildId)) return;
  if (!isAllowedChannel(message.channelId)) return;

  const channelConfig = channelMap[message.channelId];
  const hasAttachment = message.attachments.size > 0;
  const contentText = message.content?.trim() ?? '';

  let slug = channelConfig?.slug ?? '';
  let onboardingContent = '';

  if (hasAttachment) {
    const attachment = message.attachments.first();
    if (!attachment?.url) return;
    onboardingContent = await fetchAttachmentContent(attachment.url);
  } else if (channelConfig?.slug) {
    if (!contentText.startsWith(commandPrefix)) return;
    const remainder = contentText.slice(commandPrefix.length).trim();
    onboardingContent = remainder;
  } else {
    if (!contentText.startsWith(commandPrefix)) return;
    const parsed = parseOnboardMessage(contentText);
    if (!parsed) {
      await message.reply('Usage: !onboard <slug> <content>');
      return;
    }
    slug = parsed.slug;
    onboardingContent = parsed.content;
  }

  if (!slug || !onboardingContent) {
    await message.reply('Missing protocol slug or onboarding content.');
    return;
  }

  await message.reply(`Received onboarding for "${slug}". Creating tasks...`);

  try {
    const filePath = await saveOnboarding(slug, onboardingContent);
    await runOnboard(slug, filePath);
    await message.reply(`Onboarding complete for "${slug}". Tasks queued.`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await message.reply(`Onboarding failed for "${slug}": ${errorMessage}`);
  }
});

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user?.tag}`);
});

client.login(token);
