import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import multer from 'multer';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const require = createRequire(import.meta.url);
const ffmpegStaticPath = require('ffmpeg-static') as string | null;
const ffprobeStatic = require('ffprobe-static') as { path?: string };
const ffmpegBin = ffmpegStaticPath || 'ffmpeg';
const ffprobeBin = ffprobeStatic.path || 'ffprobe';

const app = express();
const port = Number(process.env.SERVER_PORT || 8787);
const dataDir = path.resolve('.data');
const tokenPath = path.join(dataDir, 'youtube-token.json');
const profilePath = path.join(dataDir, 'profile.json');
const agentPath = path.join(dataDir, 'agent.json');
const agentLogPath = path.join(dataDir, 'agent-log.json');
const agentSourceCursorPath = path.join(dataDir, 'agent-source-cursor.json');
const agentSourceHistoryPath = path.join(dataDir, 'agent-source-history.json');
const agentUploadHistoryPath = path.join(dataDir, 'agent-upload-history.json');
const notificationsPath = path.join(dataDir, 'notifications.json');
const youtubeSummarySnapshotPath = path.join(dataDir, 'youtube-summary-snapshot.json');
const voiceDir = path.join(dataDir, 'voice');
const sourceDir = path.resolve('uploads/source');
const processingDir = path.resolve('uploads/processing');
const processedDir = path.resolve('uploads/processed');
const failedDir = path.resolve('uploads/failed');
const distDir = path.resolve('dist');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });
const agentUploadIntervalMs = Number(process.env.AGENT_UPLOAD_INTERVAL_MS || 5 * 60 * 1000);
const agentTickMs = Number(process.env.AGENT_TICK_MS || 30 * 1000);
const agentOutputWidth = Number(process.env.AGENT_OUTPUT_WIDTH || 720);
const agentOutputHeight = Number(process.env.AGENT_OUTPUT_HEIGHT || 1280);
const agentShortDuration = Number(process.env.AGENT_SHORT_DURATION_SECONDS || 18);
const staleProcessingMs = Number(process.env.AGENT_STALE_PROCESSING_MS || 2 * 60 * 1000);
const agentDailyUploadLimit = Number(process.env.AGENT_DAILY_UPLOAD_LIMIT || 2);
const agentDayTimezoneOffsetMinutes = Number(process.env.AGENT_DAY_TIMEZONE_OFFSET_MINUTES || 5 * 60);
const agentUsTimezone = process.env.AGENT_US_TIMEZONE || 'America/New_York';
const agentPrimeHours = String(process.env.AGENT_US_PRIME_HOURS || '18,19,20,21')
  .split(',')
  .map((hour) => Number(hour.trim()))
  .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
const agentUseUsPrimeWindows = process.env.AGENT_USE_US_PRIME_WINDOWS === 'true';
const agentMinRecentViews = Number(process.env.AGENT_MIN_RECENT_VIDEO_VIEWS || 25);
const agentPerformanceLookback = Number(process.env.AGENT_PERFORMANCE_LOOKBACK || 6);
const agentPauseOnLowViews = process.env.AGENT_PAUSE_ON_LOW_VIEWS === 'true';
const agentRequireSourceAudio = process.env.AGENT_REQUIRE_SOURCE_AUDIO !== 'false';
const agentProbeSegmentSeconds = Number(process.env.AGENT_PROBE_SEGMENT_SECONDS || 8);
const agentMinAudioMeanVolumeDb = Number(process.env.AGENT_MIN_AUDIO_MEAN_VOLUME_DB || -35);
const agentAutostartAfterAuth = process.env.AGENT_AUTOSTART_AFTER_AUTH === 'true';
const adminEmail = (process.env.ADMIN_EMAIL || 'm6dhhjffu@gmail.com').toLowerCase();
const sessionCookieName = 'creator_pro_admin';
const agentSourceMaxBytes = Number(process.env.AGENT_SOURCE_MAX_BYTES || 280 * 1024 * 1024);
const youtubeOAuthScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];
const archiveComedyIdentifiers = [
  'eddie_cantor_1923',
  'the-sawmill',
  'out_of_this_world',
  'tomorrow_television',
  'middleton_family_worlds_fair_1939',
  'Somethin1958',
  'Somethin1940',
  '0186_Aluminum_on_the_March_M03505_05_11_50_00',
  '0731_Wonderful_World_19_01_23_00',
  'ItsEvery1954',
];
const blockedSourceTerms = [
  'horror',
  'scary',
  'ghost',
  'haunted',
  'zombie',
  'monster',
  'snake',
  'fire',
  'war',
  'weapon',
  'gun',
  'blood',
  'crash',
  'disaster',
  'explosion',
  'accident',
  'violence',
  'danger',
  'addiction',
  'beware',
  'communist',
];

interface AgentSourceCandidate {
  url: string;
  title: string;
  provider: string;
  identifier?: string;
  generated?: boolean;
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(distDir));

function readClientSecrets() {
  const secretsPath = path.resolve('client_secrets.json');

  if (!fs.existsSync(secretsPath)) {
    return null;
  }

  const parsed = JSON.parse(fs.readFileSync(secretsPath, 'utf8'));
  return parsed.web || parsed.installed || null;
}

function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(voiceDir, { recursive: true });
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(processingDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });
  fs.mkdirSync(failedDir, { recursive: true });
}

function pcmToWav(pcmData: Buffer, channels = 1, sampleRate = 24000, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

function getOAuthClient() {
  const secrets = readClientSecrets();
  const clientId = process.env.YOUTUBE_CLIENT_ID || secrets?.client_id;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || secrets?.client_secret;
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI || `http://localhost:${port}/auth/youtube/callback`;

  if (!clientId || !clientSecret) {
    return null;
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  if (fs.existsSync(tokenPath)) {
    client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, 'utf8')));
  }

  return client;
}

function getSessionSecret() {
  const secrets = readClientSecrets();
  return process.env.SESSION_SECRET || process.env.YOUTUBE_CLIENT_SECRET || secrets?.client_secret || 'creator-pro-local-session';
}

function parseCookies(cookieHeader = '') {
  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const [name, ...rest] = cookie.split('=');
        return [name, decodeURIComponent(rest.join('='))];
      }),
  );
}

function signSession(email: string) {
  const payload = Buffer.from(JSON.stringify({ email: email.toLowerCase(), createdAt: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSessionEmail(req: express.Request) {
  const cookieValue = parseCookies(req.headers.cookie)[sessionCookieName];
  if (!cookieValue) return '';

  const [payload, signature] = cookieValue.split('.');
  if (!payload || !signature) return '';

  const expected = crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
  if (signature.length !== expected.length) return '';
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return '';

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return String(parsed.email || '').toLowerCase();
  } catch {
    return '';
  }
}

function isAdminRequest(req: express.Request) {
  return readSessionEmail(req) === adminEmail;
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isAdminRequest(req)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Admin login required.', loginUrl: '/auth/admin' });
}

function getAppUrl() {
  return process.env.APP_URL || 'http://localhost:3001';
}

function readGoogleEmailFromIdToken(idToken?: string | null) {
  if (!idToken) return '';
  const [, payload] = idToken.split('.');
  if (!payload) return '';

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return String(parsed.email || '').toLowerCase();
  } catch {
    return '';
  }
}

function getStatus() {
  const secrets = readClientSecrets();
  const hasClient = Boolean((process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET) || (secrets?.client_id && secrets?.client_secret));
  const connected = fs.existsSync(tokenPath);

  return {
    server: true,
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    hasYouTubeApiKey: Boolean(process.env.YOUTUBE_API_KEY || process.env.GOOGLE_API_KEY),
    hasYouTubeOAuthClient: hasClient,
    youtubeConnected: connected,
    redirectUri: process.env.YOUTUBE_REDIRECT_URI || `http://localhost:${port}/auth/youtube/callback`,
    clientSecretType: secrets?.client_id ? (readClientSecrets()?.redirect_uris?.includes('http://localhost') ? 'installed' : 'web') : 'env',
    agentUsTimezone,
    agentPrimeHours,
    agentUseUsPrimeWindows,
    agentRequireSourceAudio,
    agentMinRecentViews,
    agentPauseOnLowViews,
    agentAutostartAfterAuth,
  };
}

function readAgentState() {
  ensureDataDir();
  if (!fs.existsSync(agentPath)) {
    return {
      running: false,
      mode: 'paused',
      lastAction: 'AI agent is paused.',
      startedAt: null,
      updatedAt: new Date().toISOString(),
      jobsCompleted: 0,
      queueCount: listSourceVideos().length,
      logs: readAgentLogs(),
      recentSources: readAgentSourceHistory(),
    };
  }

  return {
    ...JSON.parse(fs.readFileSync(agentPath, 'utf8')),
    queueCount: listSourceVideos().length,
    logs: readAgentLogs(),
    recentSources: readAgentSourceHistory(),
  };
}

function writeAgentState(nextState: Record<string, unknown>) {
  ensureDataDir();
  const current = readAgentState();
  const state = {
    ...current,
    ...nextState,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(agentPath, JSON.stringify(state, null, 2));
  return state;
}

function getAgentDayKey(date = new Date()) {
  const shifted = new Date(date.getTime() + agentDayTimezoneOffsetMinutes * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function getNextAgentDayStart() {
  const now = new Date();
  const shifted = new Date(now.getTime() + agentDayTimezoneOffsetMinutes * 60 * 1000);
  shifted.setUTCHours(24, 0, 0, 0);
  return new Date(shifted.getTime() - agentDayTimezoneOffsetMinutes * 60 * 1000);
}

function getDailyUploadCount(state: Record<string, unknown>) {
  return state.dailyUploadDay === getAgentDayKey() ? Number(state.dailyUploadCount || 0) : 0;
}

function readAgentLogs() {
  if (!fs.existsSync(agentLogPath)) return [];
  return JSON.parse(fs.readFileSync(agentLogPath, 'utf8'));
}

function appendAgentLog(message: string) {
  ensureDataDir();
  const logs = readAgentLogs();
  logs.unshift({ at: new Date().toISOString(), message });
  fs.writeFileSync(agentLogPath, JSON.stringify(logs.slice(0, 80), null, 2));
}

function readAgentSourceHistory() {
  if (!fs.existsSync(agentSourceHistoryPath)) return [];
  return JSON.parse(fs.readFileSync(agentSourceHistoryPath, 'utf8')) as Array<AgentSourceCandidate & { at: string }>;
}

function recordAgentSource(source: AgentSourceCandidate) {
  ensureDataDir();
  const history = readAgentSourceHistory();
  const entry = { ...source, at: new Date().toISOString() };
  history.unshift(entry);
  fs.writeFileSync(agentSourceHistoryPath, JSON.stringify(history.slice(0, 40), null, 2));
  writeAgentState({ currentSource: entry });
}

function readAgentUploadHistory() {
  if (!fs.existsSync(agentUploadHistoryPath)) return [];
  return JSON.parse(fs.readFileSync(agentUploadHistoryPath, 'utf8')) as Array<{
    at: string;
    title: string;
    videoId?: string;
    sourceTitle?: string;
  }>;
}

function normalizeUploadTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/#shorts/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function assertUploadIsFresh(title: string) {
  const normalizedTitle = normalizeUploadTitle(title);
  const history = readAgentUploadHistory();
  const repeated = history.find((item) => normalizeUploadTitle(item.title) === normalizedTitle);

  if (repeated) {
    throw new Error(`AI skipped duplicate upload title: ${title}`);
  }

  if (/retro quest|neon dodge|anime arcade mini game/i.test(title)) {
    throw new Error(`AI skipped low-performing generated game template: ${title}`);
  }
}

function recordAgentUpload(title: string, videoId: string) {
  ensureDataDir();
  const currentSource = readAgentState().currentSource as { title?: string } | undefined;
  const history = readAgentUploadHistory();
  history.unshift({
    at: new Date().toISOString(),
    title,
    videoId,
    sourceTitle: currentSource?.title || '',
  });
  fs.writeFileSync(agentUploadHistoryPath, JSON.stringify(history.slice(0, 100), null, 2));
}

function isAllowedSourceCandidate(...values: Array<unknown>) {
  const text = values
    .map((value) => String(value || '').toLowerCase())
    .join(' ');
  return !blockedSourceTerms.some((term) => text.includes(term));
}

function readNotifications() {
  if (!fs.existsSync(notificationsPath)) return [];
  return JSON.parse(fs.readFileSync(notificationsPath, 'utf8')) as Array<{
    id: string;
    at: string;
    type: string;
    title: string;
    message: string;
    read: boolean;
  }>;
}

function appendNotification(type: string, title: string, message: string) {
  ensureDataDir();
  const notifications = readNotifications();
  notifications.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    type,
    title,
    message,
    read: false,
  });
  fs.writeFileSync(notificationsPath, JSON.stringify(notifications.slice(0, 80), null, 2));
}

function trackYouTubeSummaryNotifications(summary: {
  subscribers: number;
  totalViews: number;
  recentLikes: number;
  recentComments: number;
}) {
  const previous = fs.existsSync(youtubeSummarySnapshotPath)
    ? JSON.parse(fs.readFileSync(youtubeSummarySnapshotPath, 'utf8'))
    : null;

  if (previous) {
    const subscriberDelta = summary.subscribers - Number(previous.subscribers || 0);
    const viewDelta = summary.totalViews - Number(previous.totalViews || 0);
    const likeDelta = summary.recentLikes - Number(previous.recentLikes || 0);
    const commentDelta = summary.recentComments - Number(previous.recentComments || 0);

    if (subscriberDelta > 0) {
      appendNotification('subscriber', 'New subscriber', `+${subscriberDelta} subscriber. Total: ${summary.subscribers}.`);
    }
    if (likeDelta > 0) {
      appendNotification('like', 'New likes', `+${likeDelta} likes on recent videos.`);
    }
    if (commentDelta > 0) {
      appendNotification('comment', 'New comments', `+${commentDelta} comments on recent videos.`);
    }
    if (viewDelta >= 100) {
      appendNotification('views', 'Views are growing', `+${viewDelta} total views since the last scan.`);
    }
    if (summary.totalViews >= 10000 && Number(previous.totalViews || 0) < 10000) {
      appendNotification('milestone', '10K views reached', 'Channel total views crossed 10,000.');
    }
  }

  fs.writeFileSync(youtubeSummarySnapshotPath, JSON.stringify({ ...summary, updatedAt: new Date().toISOString() }, null, 2));
}

function listVideosInDir(directory: string) {
  ensureDataDir();
  const allowed = new Set(['.mp4', '.mov', '.webm', '.mkv']);
  return fs
    .readdirSync(directory)
    .filter((name) => allowed.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(directory, name));
}

function listSourceVideos() {
  return listVideosInDir(sourceDir);
}

function getLatestVideoInDir(directory: string) {
  const [latest] = listVideosInDir(directory).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return latest || '';
}

function getAgentMediaSnapshot() {
  const processed = getLatestVideoInDir(processedDir);
  const processing = getLatestVideoInDir(processingDir);
  const source = getLatestVideoInDir(sourceDir);
  const filePath = processed || processing || source;
  const stage = processed ? 'processed' : processing ? 'processing' : source ? 'source' : '';

  if (!filePath) {
    return {
      stage: '',
      fileName: '',
      url: '',
      updatedAt: '',
    };
  }

  return {
    stage,
    fileName: path.basename(filePath),
    url: `/api/agent/media/file/${stage}/${encodeURIComponent(path.basename(filePath))}`,
    updatedAt: new Date(fs.statSync(filePath).mtimeMs).toISOString(),
  };
}

function sendAgentMediaFile(req: express.Request, res: express.Response) {
  const stage = String(req.params.stage || '');
  const fileName = path.basename(String(req.params.fileName || ''));
  const directories: Record<string, string> = {
    source: sourceDir,
    processing: processingDir,
    processed: processedDir,
  };
  const directory = directories[stage];

  if (!directory || !fileName) {
    res.status(404).json({ error: 'Agent media not found.' });
    return;
  }

  const filePath = path.resolve(directory, fileName);
  const root = path.resolve(directory);

  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Agent media not found.' });
    return;
  }

  res.sendFile(filePath);
}

function cleanupStaleProcessingFiles() {
  const staleFiles = listVideosInDir(processingDir).filter((filePath) => Date.now() - fs.statSync(filePath).mtimeMs > staleProcessingMs);

  for (const filePath of staleFiles) {
    const destination = path.join(failedDir, path.basename(filePath));
    fs.renameSync(filePath, destination);
    appendAgentLog(`Moved stale processing file to failed: ${path.basename(filePath)}`);
  }
}

function safeFileName(name: string) {
  const extension = path.extname(name) || '.mp4';
  const base = path.basename(name, extension).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 80) || 'source-video';
  return `${Date.now()}-${base}${extension.toLowerCase()}`;
}

function readAgentSourceUrls() {
  return String(process.env.AGENT_SOURCE_URLS || '')
    .split(/[\n,]+/)
    .map((url) => url.trim())
    .filter(Boolean);
}

function readAgentSourceCursor() {
  if (!fs.existsSync(agentSourceCursorPath)) return 0;

  try {
    const parsed = JSON.parse(fs.readFileSync(agentSourceCursorPath, 'utf8'));
    return Number(parsed.cursor || 0);
  } catch {
    return 0;
  }
}

function writeAgentSourceCursor(cursor: number) {
  ensureDataDir();
  fs.writeFileSync(agentSourceCursorPath, JSON.stringify({ cursor }, null, 2));
}

function getNextAgentSourceUrl(): AgentSourceCandidate | null {
  const urls = readAgentSourceUrls();
  if (!urls.length) return null;

  const cursor = readAgentSourceCursor();
  const url = urls[cursor % urls.length];
  writeAgentSourceCursor(cursor + 1);
  return {
    url,
    title: `Configured source ${cursor % urls.length + 1}`,
    provider: 'Configured URL',
  };
}

async function getInternetArchiveDownloadUrl(identifier: string): Promise<AgentSourceCandidate | null> {
  const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    headers: { 'User-Agent': 'CreatorProDashboard/1.0 (public-domain comedy discovery)' },
  });

  if (!response.ok) {
    throw new Error(`Internet Archive metadata failed with ${response.status}`);
  }

  const data = await response.json();
  if (!isAllowedSourceCandidate(identifier, data.metadata?.title, data.metadata?.description)) {
    appendAgentLog(`Internet Archive source blocked by safety filter: ${data.metadata?.title || identifier}`);
    return null;
  }

  const files = (data.files || []) as Array<{ name?: string; format?: string; size?: string }>;
  const videoFile = files
    .filter((file) => /\.(mp4|webm|ogv)$/i.test(file.name || ''))
    .filter((file) => isAllowedSourceCandidate(file.name))
    .filter((file) => Number(file.size || 0) > 0 && Number(file.size || 0) <= agentSourceMaxBytes)
    .sort((a, b) => {
      const aName = String(a.name || '').toLowerCase();
      const bName = String(b.name || '').toLowerCase();
      const aScore = (aName.endsWith('.mp4') ? 0 : 10) + (String(a.format || '').toLowerCase().includes('h.264') ? 0 : 2);
      const bScore = (bName.endsWith('.mp4') ? 0 : 10) + (String(b.format || '').toLowerCase().includes('h.264') ? 0 : 2);
      return aScore - bScore || Number(a.size || 0) - Number(b.size || 0);
    })[0];

  if (!videoFile?.name) {
    return null;
  }

  const title = String(data.metadata?.title || identifier);
  appendAgentLog(`Selected public-domain source: ${title}`);
  return {
    url: `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(videoFile.name)}`,
    title,
    provider: 'Internet Archive',
    identifier,
  };
}

async function discoverInternetArchiveComedySourceUrl(): Promise<AgentSourceCandidate | null> {
  const cursor = readAgentSourceCursor();
  const preferredIdentifiers = String(process.env.AGENT_ARCHIVE_COMEDY_IDS || '')
    .split(/[\n,]+/)
    .map((identifier) => identifier.trim())
    .filter(Boolean);
  const identifiers = preferredIdentifiers.length ? preferredIdentifiers : archiveComedyIdentifiers;

  for (let index = 0; index < identifiers.length; index += 1) {
    const identifier = identifiers[(cursor + index) % identifiers.length];
    try {
      const source = await getInternetArchiveDownloadUrl(identifier);
      if (source) {
        writeAgentSourceCursor(cursor + index + 1);
        return source;
      }
    } catch (error) {
      appendAgentLog(`Internet Archive source skipped: ${identifier} (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  }

  return null;
}

async function discoverWikimediaSourceUrl(): Promise<AgentSourceCandidate | null> {
  const cursor = readAgentSourceCursor();
  const profile = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, 'utf8')) : {};
  const query = String(profile.niche || 'funny comedy surprising').replace(/[^\w\s-]/g, ' ').trim();
  const searchQueries = [
    query,
    'funny comedy public domain',
    'surprising moment',
    'funny city',
    'short funny',
    'comedy',
    'timelapse funny',
  ].filter(Boolean);

  for (const searchQuery of searchQueries) {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrnamespace: '6',
      gsrsearch: `filetype:video ${searchQuery}`,
      gsrlimit: '20',
      gsroffset: String(cursor % 200),
      prop: 'imageinfo',
      iiprop: 'url|mime|extmetadata',
      format: 'json',
      origin: '*',
    });

    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
      headers: { 'User-Agent': 'CreatorProDashboard/1.0 (rights-safe video discovery)' },
    });

    if (!response.ok) {
      throw new Error(`Wikimedia discovery failed with ${response.status}`);
    }

    const data = await response.json();
    const pages = Object.values(data.query?.pages || {}) as Array<{
      title?: string;
      imageinfo?: Array<{
        url?: string;
        mime?: string;
        extmetadata?: {
          LicenseShortName?: { value?: string };
        };
      }>;
    }>;
    const safeVideo = pages.find((page) => {
      const info = page.imageinfo?.[0];
      const license = String(info?.extmetadata?.LicenseShortName?.value || '').toLowerCase();
      return (
        info?.url &&
        info.mime?.startsWith('video/') &&
        (license.includes('cc0') || license.includes('public domain') || license.includes('pdm')) &&
        isAllowedSourceCandidate(page.title, info.url)
      );
    });

    if (safeVideo?.imageinfo?.[0]?.url) {
      writeAgentSourceCursor(cursor + 20);
      appendAgentLog(`Discovered rights-safe Wikimedia source: ${safeVideo.title || safeVideo.imageinfo[0].url}`);
      return {
        url: safeVideo.imageinfo[0].url,
        title: safeVideo.title || 'Wikimedia source',
        provider: 'Wikimedia Commons',
      };
    }
  }

  writeAgentSourceCursor(cursor + 20);
  return null;
}

function runYtDlp(url: string, outputTemplate: string) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      '-f',
      'bv*[height<=1080]+ba/b[height<=1080]/best[height<=1080]/best',
      '--merge-output-format',
      'mp4',
      '--no-playlist',
      '--max-filesize',
      '500m',
      '-o',
      outputTemplate,
      url,
    ];
    const child = spawn('yt-dlp', args);
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1200) || `yt-dlp exited with code ${code}`));
    });
  });
}

function runFfprobe(inputPath: string) {
  return new Promise<{ hasAudio: boolean; duration: number }>((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type',
      '-of',
      'json',
      inputPath,
    ];
    const child = spawn(ffprobeBin, args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-1200) || `ffprobe exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          hasAudio: (parsed.streams || []).some((stream: { codec_type?: string }) => stream.codec_type === 'audio'),
          duration: Number(parsed.format?.duration || 0),
        });
      } catch {
        reject(new Error('ffprobe returned unreadable media metadata.'));
      }
    });
  });
}

function runMotionProbe(inputPath: string, startAt: number) {
  return new Promise<{ frozen: boolean; freezeDuration: number }>((resolve, reject) => {
    const args = [
      '-v',
      'info',
      '-ss',
      String(Math.max(0, startAt)),
      '-t',
      String(agentProbeSegmentSeconds),
      '-i',
      inputPath,
      '-vf',
      'freezedetect=n=-50dB:d=3',
      '-an',
      '-f',
      'null',
      '-',
    ];
    const child = spawn(ffmpegBin, args);
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-1200) || `motion probe exited with code ${code}`));
        return;
      }

      const freezeDurations = Array.from(stderr.matchAll(/freeze_duration:\s*([0-9.]+)/g)).map((match) => Number(match[1] || 0));
      const longestFreeze = Math.max(0, ...freezeDurations);
      resolve({
        frozen: longestFreeze >= Math.min(5, agentProbeSegmentSeconds - 1),
        freezeDuration: longestFreeze,
      });
    });
  });
}

function runAudioProbe(inputPath: string, startAt: number) {
  return new Promise<{ meanVolume: number; maxVolume: number }>((resolve, reject) => {
    const args = [
      '-v',
      'info',
      '-ss',
      String(Math.max(0, startAt)),
      '-t',
      String(agentProbeSegmentSeconds),
      '-i',
      inputPath,
      '-vn',
      '-af',
      'volumedetect',
      '-f',
      'null',
      '-',
    ];
    const child = spawn(ffmpegBin, args);
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.slice(-1200) || `audio probe exited with code ${code}`));
        return;
      }

      const meanVolume = Number(stderr.match(/mean_volume:\s*(-?[0-9.]+)\s*dB/)?.[1] ?? Number.NEGATIVE_INFINITY);
      const maxVolume = Number(stderr.match(/max_volume:\s*(-?[0-9.]+)\s*dB/)?.[1] ?? Number.NEGATIVE_INFINITY);
      resolve({ meanVolume, maxVolume });
    });
  });
}

async function pickAgentClipStart(inputPath: string, duration: number) {
  const maxStart = Math.max(0, duration - agentShortDuration - 1);
  const candidates = [0.12, 0.25, 0.45, 0.65]
    .map((ratio) => Math.min(maxStart, Math.round(duration * ratio)))
    .filter((startAt, index, values) => startAt >= 0 && values.indexOf(startAt) === index);

  for (const startAt of candidates.length ? candidates : [0]) {
    const motion = await runMotionProbe(inputPath, startAt);
    if (!motion.frozen) {
      return { startAt, freezeDuration: motion.freezeDuration };
    }
  }

  throw new Error('Source video looks static/frozen. AI skipped it so a one-frame video is not uploaded.');
}

async function validateAgentSource(inputPath: string) {
  const media = await runFfprobe(inputPath);

  if (agentRequireSourceAudio && !media.hasAudio) {
    throw new Error('Source video has no audio. AI skipped it so silent content is not uploaded.');
  }

  if (media.duration && media.duration < Math.min(8, agentShortDuration)) {
    throw new Error('Source video is too short for a useful Shorts edit.');
  }

  const motion = await pickAgentClipStart(inputPath, media.duration || agentShortDuration);
  const audio = media.hasAudio ? await runAudioProbe(inputPath, motion.startAt) : { meanVolume: Number.NEGATIVE_INFINITY, maxVolume: Number.NEGATIVE_INFINITY };

  if (agentRequireSourceAudio && audio.meanVolume < agentMinAudioMeanVolumeDb) {
    throw new Error(`Source audio is too quiet (${audio.meanVolume} dB). AI skipped it so silent videos are not uploaded.`);
  }

  return { ...media, ...motion, ...audio };
}

async function downloadDirectSource(url: string, destination: string) {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Source download failed with ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(destination));
}

function runGeneratedGameSource(outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const sourceLabel = 'RETRO QUEST';
    const filter = [
      'drawgrid=width=80:height=80:thickness=2:color=0x26304d@0.35',
      "drawbox=x='mod(t*190\\,720)-90':y='230+90*sin(t*2)':w=90:h=90:color=0x00e5ff@0.9:t=fill",
      "drawbox=x='620-mod(t*140\\,720)':y='780+80*cos(t*2)':w=75:h=75:color=0xff2bd6@0.9:t=fill",
      "drawbox=x='80+40*sin(t*3)':y='1040-mod(t*95\\,360)':w=560:h=18:color=0xfacc15@0.85:t=fill",
      `drawtext=text='${sourceLabel}':x=(w-text_w)/2:y=110:fontsize=62:fontcolor=white:borderw=4:bordercolor=black`,
      "drawtext=text='DODGE THE NEON BLOCKS':x=(w-text_w)/2:y=1180:fontsize=32:fontcolor=0xfacc15:borderw=3:bordercolor=black",
      'hue=H=0.2*sin(t*1.8):s=1.35',
      'format=yuv420p',
    ].join(',');
    const args = [
      '-y',
      '-f',
      'lavfi',
      '-t',
      String(agentShortDuration),
      '-i',
      `color=c=0x101018:size=${agentOutputWidth}x${agentOutputHeight}:rate=30`,
      '-f',
      'lavfi',
      '-t',
      String(agentShortDuration),
      '-i',
      `sine=frequency=660:sample_rate=44100:duration=${agentShortDuration},volume=0.08`,
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args);
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1200) || `ffmpeg generated source exited with code ${code}`));
    });
  });
}

async function queueGeneratedGameSource() {
  const outputPath = path.join(sourceDir, `${Date.now()}-original-retro-game-source.mp4`);
  const source = {
    url: outputPath,
    title: 'Original Retro Game Challenge',
    provider: 'Creator Pro AI Generator',
    identifier: 'original-retro-game',
    generated: true,
  };

  recordAgentSource(source);
  appendAgentLog('Generating original retro game/anime-style Shorts source with FFmpeg.');
  await runGeneratedGameSource(outputPath);
  return outputPath;
}

async function queueSourceFromUrl() {
  const allowWikimediaFallback = process.env.AGENT_ALLOW_WIKIMEDIA_FALLBACK === 'true';
  const useGeneratedSource =
    process.env.AGENT_USE_GENERATED_GAME_SOURCE === 'true' &&
    process.env.AGENT_ALLOW_LOW_PERFORMANCE_GENERATED_GAME === 'true';
  if (useGeneratedSource) {
    return queueGeneratedGameSource();
  }

  const source =
    getNextAgentSourceUrl() ||
    (await discoverInternetArchiveComedySourceUrl()) ||
    (allowWikimediaFallback ? await discoverWikimediaSourceUrl() : null);

  if (!source) {
    return null;
  }

  recordAgentSource(source);
  const sourceUrl = source.url;
  const urlPath = URL.canParse(sourceUrl) ? new URL(sourceUrl).pathname : '';
  const extension = ['.mp4', '.mov', '.webm', '.mkv'].includes(path.extname(urlPath).toLowerCase())
    ? path.extname(urlPath).toLowerCase()
    : '.mp4';
  const baseName = safeFileName(`auto-source${extension}`);
  const directDestination = path.join(sourceDir, baseName);
  const outputTemplate = path.join(sourceDir, `${Date.now()}-auto-source.%(ext)s`);

  appendAgentLog(`Fetching source video from configured source: ${sourceUrl}`);

  if (/\.(mp4|mov|webm|mkv)(\?|#|$)/i.test(sourceUrl)) {
    await downloadDirectSource(sourceUrl, directDestination);
    return directDestination;
  }

  await runYtDlp(sourceUrl, outputTemplate);
  const downloaded = listSourceVideos().sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];

  if (!downloaded) {
    throw new Error('yt-dlp finished but did not create a source video.');
  }

  return downloaded;
}

function runFfmpeg(inputPath: string, outputPath: string, startAt = 0) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-ss',
      String(Math.max(0, startAt)),
      '-i',
      inputPath,
      '-t',
      String(agentShortDuration),
      '-vf',
      `scale=${agentOutputWidth}:${agentOutputHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${agentOutputWidth}:${agentOutputHeight}:(ow-iw)/2:(oh-ih)/2:black,unsharp=5:5:0.55:3:3:0.25,eq=contrast=1.06:saturation=1.12,setsar=1,format=yuv420p`,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-threads',
      '1',
      '-preset',
      'veryfast',
      '-crf',
      '21',
      '-maxrate',
      '6M',
      '-bufsize',
      '12M',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
      '-movflags',
      '+faststart',
      outputPath,
    ];
    const child = spawn(ffmpegBin, args);
    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1200) || `ffmpeg exited with code ${code}`));
    });
  });
}

function buildUploadMetadata(sourcePath: string) {
  const profile = fs.existsSync(profilePath) ? JSON.parse(fs.readFileSync(profilePath, 'utf8')) : {};
  const rawTopic = String(profile.niche || '').trim();
  const topic = /automation|dashboard|creator pro|youtube ai/i.test(rawTopic) ? 'funny facts and useful shorts' : rawTopic || 'funny facts and useful shorts';
  const currentSource = readAgentState().currentSource as { title?: string; provider?: string; generated?: boolean } | undefined;
  const isGeneratedGame = Boolean(currentSource?.generated || currentSource?.provider === 'Creator Pro AI Generator');
  const sourceTitle = String(currentSource?.title || '').replace(/[_-]+/g, ' ').trim();
  const titleSeed = path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, ' ');
  const hooks = isGeneratedGame
    ? [
        'Can you beat this level',
        'Retro game challenge in 18 seconds',
        'This level gets faster',
        'Neon dodge challenge',
        'Anime arcade mini game',
        'Watch the final move',
      ]
    : [
        'People really used to do this',
        'This old moment is still funny',
        'A tiny piece of history',
        'This is oddly satisfying',
        'You probably have not seen this',
        'Useful and funny in 18 seconds',
        'The ending is worth it',
        'This vintage clip feels unreal',
      ];
  const hook = hooks[Math.abs(titleSeed.length + new Date().getMinutes()) % hooks.length];
  const titleContext = sourceTitle ? ` - ${sourceTitle}` : '';
  const title = `${hook}${titleContext} #shorts`.slice(0, 100);

  return {
    title,
    description: [
      `Quick AI-edited Shorts clip made from a rights-safe public-domain source.`,
      sourceTitle ? `Source theme: ${sourceTitle}` : `Theme: ${topic}`,
      `If this was interesting or made you smile, like and subscribe for more short clips.`,
      `Topic: ${topic}`,
      `New short clips are posted daily.`,
      '',
      isGeneratedGame ? '#shorts #gaming #anime #retrogaming' : '#shorts #funny #didyouknow',
    ].join('\n'),
    tags: (isGeneratedGame
      ? [
          'shorts',
          'gaming shorts',
          'anime style',
          'retro gaming',
          'arcade game',
          'mobile game',
          'game challenge',
          'neon game',
          'satisfying shorts',
          'viral shorts',
        ]
      : [
          'shorts',
          'funny shorts',
          'did you know',
          'interesting facts',
          'useful shorts',
          'vintage comedy',
          'public domain',
          'history shorts',
          'viral shorts',
          'daily shorts',
          String(topic).toLowerCase(),
        ]).filter(Boolean),
  };
}

function buildDraftUploadMetadata(videoPath: string) {
  const state = readAgentState();
  const draftMetadata = state.draftMetadata as { title?: string; description?: string; tags?: string[] } | undefined;

  if (draftMetadata?.title && draftMetadata?.description && Array.isArray(draftMetadata.tags)) {
    return {
      title: draftMetadata.title,
      description: draftMetadata.description,
      tags: draftMetadata.tags,
    };
  }

  const titleSeed = path.basename(videoPath, path.extname(videoPath)).replace(/[-_]+/g, ' ');
  return {
    title: `AI Creator Boost - Better Shorts Strategy #shorts`.slice(0, 100),
    description: [
      'Original AI-generated short with audible sound and motion.',
      `Draft: ${titleSeed}`,
      'Posted from Creator Pro after quality checks for audio, motion and duplicate titles.',
      '',
      '#shorts #creator #aitools #growth',
    ].join('\n'),
    tags: ['shorts', 'creator tips', 'ai tools', 'youtube growth', 'content strategy'],
  };
}

async function uploadVideoPath(videoPath: string, metadata: { title: string; description: string; tags: string[] }) {
  const client = getOAuthClient();

  if (!client || !fs.existsSync(tokenPath)) {
    throw new Error('YouTube account is not connected.');
  }

  const privacyStatus = ['private', 'unlisted', 'public'].includes(process.env.AGENT_PRIVACY_STATUS || '')
    ? process.env.AGENT_PRIVACY_STATUS
    : 'public';

  const youtube = google.youtube({ version: 'v3', auth: client });
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: process.env.AGENT_YOUTUBE_CATEGORY_ID || '24',
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
      mimeType: 'video/mp4',
    },
  });

  return response.data.id;
}

let agentWorking = false;

function getHourInTimezone(date: Date, timeZone: string) {
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  return Number(hour);
}

function getNextUsPrimeWindow(now = new Date()) {
  const hours = agentPrimeHours.length ? agentPrimeHours : [18, 19, 20, 21];
  const currentHour = getHourInTimezone(now, agentUsTimezone);

  if (hours.includes(currentHour)) {
    return now;
  }

  for (let minutes = 15; minutes <= 48 * 60; minutes += 15) {
    const candidate = new Date(now.getTime() + minutes * 60 * 1000);
    if (hours.includes(getHourInTimezone(candidate, agentUsTimezone))) {
      candidate.setUTCMinutes(Math.ceil(candidate.getUTCMinutes() / 15) * 15, 0, 0);
      return candidate;
    }
  }

  return new Date(now.getTime() + agentUploadIntervalMs);
}

function getNextAgentRunAt(lastUploadAt?: unknown) {
  const lastUploadTime = lastUploadAt ? new Date(String(lastUploadAt)).getTime() : 0;
  const intervalReadyAt = lastUploadTime ? new Date(lastUploadTime + agentUploadIntervalMs) : new Date();

  if (!agentUseUsPrimeWindows) {
    return intervalReadyAt.toISOString();
  }

  return getNextUsPrimeWindow(intervalReadyAt).toISOString();
}

function shouldWaitForNextUpload(lastUploadAt?: unknown) {
  return new Date(getNextAgentRunAt(lastUploadAt)).getTime() > Date.now();
}

async function getRecentChannelPerformance() {
  const client = getOAuthClient();

  if (!client || !fs.existsSync(tokenPath)) {
    return null;
  }

  const youtube = google.youtube({ version: 'v3', auth: client });
  const channelResponse = await youtube.channels.list({
    mine: true,
    part: ['contentDetails'],
  });
  const uploadsPlaylistId = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylistId) {
    return null;
  }

  const playlistResponse = await youtube.playlistItems.list({
    playlistId: uploadsPlaylistId,
    part: ['contentDetails'],
    maxResults: Math.min(50, Math.max(agentPerformanceLookback, 3)),
  });
  const videoIds = (playlistResponse.data.items || [])
    .map((item) => item.contentDetails?.videoId)
    .filter(Boolean)
    .slice(0, agentPerformanceLookback) as string[];

  if (!videoIds.length) {
    return null;
  }

  const videosResponse = await youtube.videos.list({
    id: videoIds,
    part: ['snippet', 'statistics'],
  });
  const videos = (videosResponse.data.items || []).map((video) => ({
    id: video.id || '',
    title: video.snippet?.title || 'Untitled',
    views: Number(video.statistics?.viewCount || 0),
    likes: Number(video.statistics?.likeCount || 0),
    comments: Number(video.statistics?.commentCount || 0),
    publishedAt: video.snippet?.publishedAt || '',
  }));
  const averageViews = videos.length
    ? Math.round(videos.reduce((total, video) => total + video.views, 0) / videos.length)
    : 0;

  return {
    averageViews,
    checkedVideos: videos.length,
    latestTitle: videos[0]?.title || '',
    latestViews: videos[0]?.views || 0,
    underperforming: videos.length >= 3 && averageViews < agentMinRecentViews,
    videos,
    checkedAt: new Date().toISOString(),
  };
}

async function processNextAgentJob() {
  const state = readAgentState();
  if (!state.running || agentWorking) return;

  cleanupStaleProcessingFiles();

  const dailyUploadCount = getDailyUploadCount(state);
  if (dailyUploadCount >= agentDailyUploadLimit) {
    const nextRunAt = getNextAgentDayStart().toISOString();
    writeAgentState({
      mode: 'running',
      dailyUploadDay: getAgentDayKey(),
      dailyUploadCount,
      nextRunAt,
      lastAction: `Daily upload limit reached (${dailyUploadCount}/${agentDailyUploadLimit}). AI will wait until ${nextRunAt}.`,
    });
    return;
  }

  const processingFiles = listVideosInDir(processingDir);
  if (processingFiles.length) {
    writeAgentState({
      mode: 'editing',
      lastAction: `AI agent is still processing ${path.basename(processingFiles[0])}.`,
    });
    return;
  }

  const explicitNextRunAt = state.nextRunAt ? new Date(String(state.nextRunAt)).getTime() : 0;
  if (explicitNextRunAt && explicitNextRunAt > Date.now()) {
    writeAgentState({
      mode: state.mode || 'running',
      nextRunAt: new Date(explicitNextRunAt).toISOString(),
      lastAction: state.lastAction || `AI agent is waiting until ${new Date(explicitNextRunAt).toISOString()}.`,
    });
    return;
  }

  const lastCycleAt = state.lastAttemptAt || state.lastUploadAt;
  if (shouldWaitForNextUpload(lastCycleAt)) {
    const nextRunAt = getNextAgentRunAt(lastCycleAt);
    writeAgentState({
      mode: 'running',
      nextRunAt,
      lastAction: agentUseUsPrimeWindows
        ? `AI agent is waiting for the next US audience window: ${nextRunAt}.`
        : `AI agent is running. Next upload cycle: ${nextRunAt}.`,
    });
    return;
  }

  try {
    const performance = await getRecentChannelPerformance();
    if (performance) {
      writeAgentState({ lastPerformance: performance });

      if (agentPauseOnLowViews && performance.underperforming) {
        const nextRunAt = getNextUsPrimeWindow(new Date(Date.now() + 6 * 60 * 60 * 1000)).toISOString();
        appendAgentLog(
          `Recent views are low (${performance.averageViews} avg across ${performance.checkedVideos} videos). Agent is slowing down and will re-check before uploading.`,
        );
        writeAgentState({
          mode: 'reviewing-performance',
          nextRunAt,
          lastAttemptAt: new Date().toISOString(),
          lastAction: `Recent videos average ${performance.averageViews} views. AI paused uploads until the next US prime-time re-check.`,
        });
        return;
      }

      if (performance.underperforming) {
        appendAgentLog(
          `Recent views are low (${performance.averageViews} avg), but auto-pause is off so the agent will keep the old upload rhythm.`,
        );
      }
    }
  } catch (error) {
    appendAgentLog(`Performance check skipped: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  agentWorking = true;
  const processedDraft = getLatestVideoInDir(processedDir);
  if (processedDraft) {
    try {
      const media = await validateAgentSource(processedDraft);
      appendAgentLog(
        `Uploading prepared draft after quality check: audio=${media.hasAudio ? 'yes' : 'no'}, mean=${media.meanVolume} dB.`,
      );
      const metadata = buildDraftUploadMetadata(processedDraft);
      assertUploadIsFresh(metadata.title);
      writeAgentState({ mode: 'uploading', lastAction: `Uploading prepared draft: ${metadata.title}` });
      const videoId = await uploadVideoPath(processedDraft, metadata);
      recordAgentUpload(metadata.title, String(videoId || ''));
      appendAgentLog(`Uploaded prepared draft to YouTube. Video ID: ${videoId}`);
      fs.rmSync(processedDraft, { force: true });
      const lastUploadAt = new Date().toISOString();
      const nextDailyCount = getDailyUploadCount(readAgentState()) + 1;
      const nextRunAt = nextDailyCount >= agentDailyUploadLimit ? getNextAgentDayStart().toISOString() : getNextAgentRunAt(lastUploadAt);
      writeAgentState({
        mode: 'running',
        jobsCompleted: Number(state.jobsCompleted || 0) + 1,
        lastAction:
          nextDailyCount >= agentDailyUploadLimit
            ? `Uploaded prepared draft. Daily limit reached (${nextDailyCount}/${agentDailyUploadLimit}).`
            : `Uploaded prepared draft. Video ID: ${videoId}`,
        lastUploadAt,
        dailyUploadDay: getAgentDayKey(new Date(lastUploadAt)),
        dailyUploadCount: nextDailyCount,
        nextRunAt,
        draftMetadata: null,
        error: '',
      });
      agentWorking = false;
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Prepared draft upload failed.';
      appendAgentLog(`Prepared draft error: ${message}`);
      writeAgentState({
        mode: 'running',
        running: true,
        lastAttemptAt: new Date().toISOString(),
        nextRunAt: new Date(Date.now() + agentUploadIntervalMs).toISOString(),
        lastAction: 'AI could not upload the prepared draft and will retry later.',
        error: message,
      });
      agentWorking = false;
      return;
    }
  }

  let [nextSource] = listSourceVideos();
  if (!nextSource) {
    try {
      writeAgentState({
        mode: 'finding-source',
        lastAction: 'AI agent is finding a rights-safe source video.',
      });
      nextSource = (await queueSourceFromUrl()) || undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not fetch source video.';
      appendAgentLog(`Source fetch error: ${message}`);
      writeAgentState({
        mode: 'running',
        nextRunAt: new Date(Date.now() + agentUploadIntervalMs).toISOString(),
        lastAction: 'AI agent could not fetch a source video. It will retry.',
        error: message,
      });
      agentWorking = false;
      return;
    }

    if (!nextSource) {
      writeAgentState({
        mode: 'running',
        lastAction: 'AI agent is running. Add videos to uploads/source or set AGENT_SOURCE_URLS.',
      });
      agentWorking = false;
      return;
    }
  }

  const processingPath = path.join(processingDir, path.basename(nextSource));
  const outputPath = path.join(processedDir, `${path.basename(nextSource, path.extname(nextSource))}-short.mp4`);

  try {
    const lastAttemptAt = new Date().toISOString();
    fs.renameSync(nextSource, processingPath);
    appendAgentLog(`Started editing ${path.basename(processingPath)}.`);
    writeAgentState({
      mode: 'editing',
      lastAttemptAt,
      nextRunAt: getNextAgentRunAt(lastAttemptAt),
      lastAction: `Editing ${path.basename(processingPath)} with FFmpeg.`,
    });

    const media = await validateAgentSource(processingPath);
    appendAgentLog(
      `Source quality check passed: audio=${media.hasAudio ? 'yes' : 'no'}, mean=${media.meanVolume} dB, duration=${media.duration ? Math.round(media.duration) : 'unknown'}s, clipStart=${media.startAt}s.`,
    );
    await runFfmpeg(processingPath, outputPath, media.startAt);

    const metadata = buildUploadMetadata(processingPath);
    assertUploadIsFresh(metadata.title);
    appendAgentLog(`Uploading ${path.basename(outputPath)} to YouTube as ${process.env.AGENT_PRIVACY_STATUS || 'public'}.`);
    writeAgentState({ mode: 'uploading', lastAction: `Uploading ${metadata.title}` });

    const videoId = await uploadVideoPath(outputPath, metadata);
    recordAgentUpload(metadata.title, String(videoId || ''));
    appendAgentLog(`Uploaded video to YouTube. Video ID: ${videoId}`);
    fs.rmSync(processingPath, { force: true });
    const lastUploadAt = new Date().toISOString();
    const nextDailyCount = getDailyUploadCount(readAgentState()) + 1;
    const nextRunAt = nextDailyCount >= agentDailyUploadLimit ? getNextAgentDayStart().toISOString() : getNextAgentRunAt(lastUploadAt);
    writeAgentState({
      mode: 'running',
      jobsCompleted: Number(state.jobsCompleted || 0) + 1,
      lastAction:
        nextDailyCount >= agentDailyUploadLimit
          ? `Uploaded video. Daily limit reached (${nextDailyCount}/${agentDailyUploadLimit}).`
          : `Uploaded video. Video ID: ${videoId}`,
      lastUploadAt,
      dailyUploadDay: getAgentDayKey(new Date(lastUploadAt)),
      dailyUploadCount: nextDailyCount,
      nextRunAt,
      error: '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    appendAgentLog(`Worker error: ${message}`);
    if (fs.existsSync(processingPath)) {
      fs.renameSync(processingPath, path.join(failedDir, path.basename(processingPath)));
    }
    writeAgentState({
      mode: 'running',
      running: true,
      lastAttemptAt: new Date().toISOString(),
      nextRunAt: new Date(Date.now() + agentUploadIntervalMs).toISOString(),
      lastAction: 'AI agent hit an error and will retry on the next cycle.',
      error: message,
    });
  } finally {
    agentWorking = false;
  }
}

async function prepareAgentDraft() {
  if (agentWorking) {
    return {
      state: writeAgentState({
        mode: 'editing',
        lastAction: 'AI agent is already preparing a video.',
      }),
      metadata: null,
    };
  }

  agentWorking = true;
  let nextSource = getLatestVideoInDir(sourceDir);
  let processingPath = '';

  try {
    if (!nextSource) {
      writeAgentState({
        mode: 'finding-source',
        lastAction: 'AI is generating a source video for the editor.',
      });
      nextSource = (await queueSourceFromUrl()) || '';
    }

    if (!nextSource) {
      throw new Error('AI could not prepare a source video.');
    }

    processingPath = path.join(processingDir, path.basename(nextSource));
    const outputPath = path.join(processedDir, `${path.basename(nextSource, path.extname(nextSource))}-short.mp4`);
    fs.renameSync(nextSource, processingPath);

    writeAgentState({
      running: false,
      mode: 'editing',
      lastAttemptAt: new Date().toISOString(),
      lastAction: `AI is preparing ${path.basename(processingPath)} for preview.`,
      error: '',
    });

    const media = await validateAgentSource(processingPath);
    await runFfmpeg(processingPath, outputPath, media.startAt);
    const metadata = buildUploadMetadata(processingPath);
    assertUploadIsFresh(metadata.title);
    fs.rmSync(processingPath, { force: true });

    const state = writeAgentState({
      running: false,
      mode: 'draft-ready',
      lastAction: `AI draft is ready: ${metadata.title}`,
      draftMetadata: metadata,
      error: '',
    });
    appendAgentLog(`AI draft prepared for editor: ${metadata.title}`);

    return {
      state,
      metadata,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI draft preparation failed.';
    appendAgentLog(`Draft error: ${message}`);

    if (processingPath && fs.existsSync(processingPath)) {
      fs.renameSync(processingPath, path.join(failedDir, path.basename(processingPath)));
    }

    const state = writeAgentState({
      running: false,
      mode: 'paused',
      lastAction: 'AI could not prepare a video draft.',
      error: message,
    });

    throw Object.assign(new Error(message), { state });
  } finally {
    agentWorking = false;
  }
}

function startAgentAfterOAuth() {
  const state = writeAgentState({
    running: true,
    mode: 'running',
    startedAt: new Date().toISOString(),
    nextRunAt: getNextAgentRunAt(readAgentState().lastUploadAt),
    lastAction: `YouTube connected. AI agent started automatically and will upload up to ${agentDailyUploadLimit} videos per day.`,
    error: '',
  });
  appendAgentLog('YouTube OAuth connected. AI agent auto-started.');
  void processNextAgentJob();
  return state;
}

app.get('/api/config/status', requireAdmin, (_req, res) => {
  res.json(getStatus());
});

app.get('/api/session', (req, res) => {
  const email = readSessionEmail(req);
  res.json({
    authenticated: email === adminEmail,
    email: email === adminEmail ? email : '',
    adminEmail,
    loginUrl: '/auth/admin',
  });
});

app.get('/api/notifications', requireAdmin, (_req, res) => {
  const notifications = readNotifications();
  res.json({
    unreadCount: notifications.filter((notification) => !notification.read).length,
    notifications,
  });
});

app.post('/api/notifications/read', requireAdmin, (_req, res) => {
  const notifications = readNotifications().map((notification) => ({ ...notification, read: true }));
  fs.writeFileSync(notificationsPath, JSON.stringify(notifications, null, 2));
  res.json({ ok: true, unreadCount: 0, notifications });
});

app.get('/api/voice/welcome', async (_req, res) => {
  try {
    ensureDataDir();
    const cachePath = path.join(voiceDir, 'welcome-janob.wav');

    if (fs.existsSync(cachePath)) {
      res.type('audio/wav').sendFile(cachePath);
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({ error: 'GEMINI_API_KEY is missing.' });
      return;
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'Say in a calm, respectful Uzbek male assistant voice: "Xush kelibsiz, janob."',
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ error: errorText });
      return;
    }

    const result = await response.json();
    const data = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

    if (!data) {
      res.status(502).json({ error: 'Gemini did not return audio.' });
      return;
    }

    const wav = pcmToWav(Buffer.from(data, 'base64'));
    fs.writeFileSync(cachePath, wav);
    res.type('audio/wav').send(wav);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Gemini voice generation failed.',
    });
  }
});

app.get('/api/agent/public-media', (_req, res) => {
  const state = readAgentState();
  const media = getAgentMediaSnapshot();
  res.json({
    running: Boolean(state.running),
    mode: state.mode || 'paused',
    lastAction: state.lastAction || 'AI draft preview is ready.',
    media: media.url
      ? {
          ...media,
          url: media.url.replace('/api/agent/media/file/', '/api/agent/public-media/file/'),
        }
      : media,
    error: state.error || '',
  });
});

app.get('/api/agent/public-media/file/:stage/:fileName', sendAgentMediaFile);

app.get('/api/agent/status', requireAdmin, (_req, res) => {
  res.json({
    ...readAgentState(),
    media: getAgentMediaSnapshot(),
  });
});

app.get('/api/agent/media', requireAdmin, (_req, res) => {
  res.json({
    agent: readAgentState(),
    media: getAgentMediaSnapshot(),
  });
});

app.get('/api/agent/media/file/:stage/:fileName', requireAdmin, (req, res) => {
  sendAgentMediaFile(req, res);
});

app.post('/api/agent/prepare', requireAdmin, async (_req, res) => {
  try {
    const result = await prepareAgentDraft();
    res.json({
      ok: true,
      ...result.state,
      media: getAgentMediaSnapshot(),
      metadata: result.metadata,
    });
  } catch (error) {
    const state = error instanceof Error && 'state' in error ? (error as Error & { state?: Record<string, unknown> }).state : readAgentState();
    res.status(502).json({
      error: error instanceof Error ? error.message : 'AI draft preparation failed.',
      ...state,
      media: getAgentMediaSnapshot(),
    });
  }
});

app.post('/api/agent/start', requireAdmin, (_req, res) => {
  if (!fs.existsSync(tokenPath)) {
    void prepareAgentDraft()
      .then((result) => {
        res.status(409).json({
          error: 'YouTube account is not connected. AI draft is ready in the editor, but upload needs Google/YouTube OAuth.',
          ...result.state,
          media: getAgentMediaSnapshot(),
          metadata: result.metadata,
        });
      })
      .catch((error) => {
        res.status(409).json({
          error: error instanceof Error ? error.message : 'YouTube account is not connected and AI draft could not be prepared.',
          ...readAgentState(),
          media: getAgentMediaSnapshot(),
        });
      });
    return;
  }

  const state = writeAgentState({
    running: true,
    mode: 'running',
    startedAt: new Date().toISOString(),
    nextRunAt: getNextAgentRunAt(readAgentState().lastUploadAt),
    lastAction: `AI agent started. It will check views, require source audio, and upload during US audience windows.`,
    error: '',
  });
  appendAgentLog('AI agent started by admin.');
  void processNextAgentJob();

  res.json(state);
});

app.post('/api/agent/pause', requireAdmin, (_req, res) => {
  const state = writeAgentState({
    running: false,
    mode: 'paused',
    lastAction: 'AI agent paused by admin.',
  });
  appendAgentLog('AI agent paused by admin.');

  res.json(state);
});

app.post('/api/agent/source', requireAdmin, upload.single('video'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Video file is required.' });
    return;
  }

  ensureDataDir();
  const fileName = safeFileName(req.file.originalname);
  const destination = path.join(sourceDir, fileName);
  fs.writeFileSync(destination, req.file.buffer);
  appendAgentLog(`Source video added to queue: ${fileName}`);
  writeAgentState({ lastAction: `Source video queued: ${fileName}` });
  void processNextAgentJob();
  res.json({ ok: true, fileName, queueCount: listSourceVideos().length });
});

app.get('/api/profile', requireAdmin, (_req, res) => {
  if (!fs.existsSync(profilePath)) {
    res.json({});
    return;
  }

  res.json(JSON.parse(fs.readFileSync(profilePath, 'utf8')));
});

app.put('/api/profile', requireAdmin, (req, res) => {
  ensureDataDir();
  fs.writeFileSync(profilePath, JSON.stringify(req.body || {}, null, 2));
  res.json({ ok: true, profile: req.body || {} });
});

app.get('/auth/admin', (_req, res) => {
  const client = getOAuthClient();

  if (!client) {
    res.status(400).send('Google OAuth client is not configured.');
    return;
  }

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent select_account',
    state: 'admin-login',
    scope: youtubeOAuthScopes,
  });

  res.redirect(url);
});

app.post('/auth/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/auth/youtube', (req, res) => {
  if (!isAdminRequest(req)) {
    res.redirect('/auth/admin');
    return;
  }

  const client = getOAuthClient();

  if (!client) {
    res.status(400).send('YOUTUBE_CLIENT_ID va YOUTUBE_CLIENT_SECRET .env.local ichiga kiritilmagan.');
    return;
  }

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state: 'youtube-connect',
    scope: youtubeOAuthScopes,
  });

  res.redirect(url);
});

app.get('/auth/youtube/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const state = String(req.query.state || '');
  const client = getOAuthClient();

  if (!client || !code) {
    res.status(400).send('OAuth callback failed.');
    return;
  }

  const { tokens } = await client.getToken(code);
  if (state === 'admin-login') {
    const email = readGoogleEmailFromIdToken(tokens.id_token);

    if (email !== adminEmail) {
      res.status(403).send(`Bu dashboard faqat ${adminEmail} uchun. Siz kirgan akkaunt: ${email || 'unknown'}`);
      return;
    }

    ensureDataDir();
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    if (agentAutostartAfterAuth) {
      startAgentAfterOAuth();
    }
    res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(signSession(email))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    res.redirect(`${getAppUrl()}?admin=connected${agentAutostartAfterAuth ? '&ai=started' : ''}`);
    return;
  }

  if (!isAdminRequest(req)) {
    res.redirect('/?auth=required');
    return;
  }

  ensureDataDir();
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  if (agentAutostartAfterAuth) {
    startAgentAfterOAuth();
  }
  res.redirect(`${getAppUrl()}?youtube=connected${agentAutostartAfterAuth ? '&ai=started' : ''}`);
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    next();
    return;
  }

  const indexPath = path.join(distDir, 'index.html');

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
    return;
  }

  res.redirect(process.env.APP_URL || 'http://localhost:3001');
});

app.post('/auth/youtube/disconnect', requireAdmin, (_req, res) => {
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }

  res.json({ ok: true });
});

app.get('/api/youtube/channel', requireAdmin, async (_req, res) => {
  const client = getOAuthClient();

  if (!client || !fs.existsSync(tokenPath)) {
    res.status(401).json({ error: 'YouTube account is not connected.' });
    return;
  }

  const youtube = google.youtube({ version: 'v3', auth: client });
  const response = await youtube.channels.list({
    mine: true,
    part: ['snippet', 'statistics', 'status'],
  });

  res.json(response.data.items?.[0] || null);
});

app.get('/api/youtube/summary', requireAdmin, async (_req, res) => {
  const client = getOAuthClient();

  if (!client || !fs.existsSync(tokenPath)) {
    res.status(401).json({ error: 'YouTube account is not connected.' });
    return;
  }

  try {
    const youtube = google.youtube({ version: 'v3', auth: client });
    const channelResponse = await youtube.channels.list({
      mine: true,
      part: ['snippet', 'statistics', 'contentDetails'],
    });
    const channel = channelResponse.data.items?.[0];
    const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads;
    const chart = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => ({ name, views: 0, revenue: 0 }));
    let recentViews = 0;
    let recentLikes = 0;
    let recentComments = 0;
    let latestVideoCount = 0;

    if (uploadsPlaylistId) {
      const playlistResponse = await youtube.playlistItems.list({
        playlistId: uploadsPlaylistId,
        part: ['contentDetails'],
        maxResults: 50,
      });
      const videoIds = (playlistResponse.data.items || [])
        .map((item) => item.contentDetails?.videoId)
        .filter(Boolean) as string[];

      if (videoIds.length) {
        const videosResponse = await youtube.videos.list({
          id: videoIds,
          part: ['snippet', 'statistics'],
        });

        for (const video of videosResponse.data.items || []) {
          const views = Number(video.statistics?.viewCount || 0);
          const publishedAt = video.snippet?.publishedAt ? new Date(video.snippet.publishedAt) : null;
          recentViews += views;
          recentLikes += Number(video.statistics?.likeCount || 0);
          recentComments += Number(video.statistics?.commentCount || 0);
          latestVideoCount += 1;

          if (publishedAt) {
            const ageMs = Date.now() - publishedAt.getTime();
            if (ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000) {
              const dayName = publishedAt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
              const bucket = chart.find((item) => item.name === dayName);
              if (bucket) bucket.views += views;
            }
          }
        }
      }
    }

    const summary = {
      channelTitle: channel?.snippet?.title || '',
      subscribers: Number(channel?.statistics?.subscriberCount || 0),
      subscribersHidden: Boolean(channel?.statistics?.hiddenSubscriberCount),
      totalViews: Number(channel?.statistics?.viewCount || 0),
      totalVideos: Number(channel?.statistics?.videoCount || 0),
      recentViews,
      recentLikes,
      recentComments,
      latestVideoCount,
      estimatedRevenue: null,
      avgWatchTime: null,
      chart,
      updatedAt: new Date().toISOString(),
    };

    trackYouTubeSummaryNotifications(summary);
    res.json(summary);
  } catch (error) {
    console.error('Could not load YouTube summary', error);
    res.status(502).json({ error: 'YouTube statistics could not be loaded. Reconnect YouTube if this continues.' });
  }
});

app.get('/api/youtube/videos', requireAdmin, async (_req, res) => {
  const client = getOAuthClient();

  if (!client || !fs.existsSync(tokenPath)) {
    res.status(401).json({ error: 'YouTube account is not connected.' });
    return;
  }

  try {
    const youtube = google.youtube({ version: 'v3', auth: client });
    const channelResponse = await youtube.channels.list({
      mine: true,
      part: ['contentDetails'],
    });
    const uploadsPlaylistId = channelResponse.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

    if (!uploadsPlaylistId) {
      res.json([]);
      return;
    }

    const playlistResponse = await youtube.playlistItems.list({
      playlistId: uploadsPlaylistId,
      part: ['snippet', 'contentDetails'],
      maxResults: 12,
    });
    const videoIds = (playlistResponse.data.items || [])
      .map((item) => item.contentDetails?.videoId)
      .filter(Boolean) as string[];

    if (!videoIds.length) {
      res.json([]);
      return;
    }

    const videosResponse = await youtube.videos.list({
      id: videoIds,
      part: ['snippet', 'statistics', 'contentDetails', 'status'],
    });
    const videos = (videosResponse.data.items || []).map((video) => ({
      id: video.id,
      title: video.snippet?.title || 'Untitled video',
      thumbnail:
        video.snippet?.thumbnails?.medium?.url ||
        video.snippet?.thumbnails?.default?.url ||
        '',
      views: Number(video.statistics?.viewCount || 0),
      likes: Number(video.statistics?.likeCount || 0),
      comments: Number(video.statistics?.commentCount || 0),
      duration: video.contentDetails?.duration || '',
      publishedAt: video.snippet?.publishedAt || '',
      privacyStatus: video.status?.privacyStatus || 'unknown',
      url: `https://www.youtube.com/watch?v=${video.id}`,
    }));

    res.json(videos);
  } catch (error) {
    console.error('Could not load YouTube videos', error);
    res.status(502).json({ error: 'YouTube videos could not be loaded. Reconnect YouTube if this continues.' });
  }
});

app.post('/api/youtube/upload', requireAdmin, upload.single('video'), async (req, res) => {
  const client = getOAuthClient();

  if (!client || !fs.existsSync(tokenPath)) {
    res.status(401).json({ error: 'YouTube account is not connected.' });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: 'Video file is required.' });
    return;
  }

  const title = String(req.body.title || 'Creator Pro upload').slice(0, 100);
  const description = String(req.body.description || '');
  const tags = String(req.body.tags || '')
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean);
  const privacyStatus = ['private', 'unlisted', 'public'].includes(req.body.privacyStatus)
    ? req.body.privacyStatus
    : 'private';

  const youtube = google.youtube({ version: 'v3', auth: client });
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: '22',
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: Readable.from(req.file.buffer),
      mimeType: req.file.mimetype,
    },
  });

  res.json({ ok: true, videoId: response.data.id, video: response.data });
});

app.listen(port, () => {
  console.log(`Creator Pro API server running on http://localhost:${port}`);
});

setInterval(() => {
  void processNextAgentJob();
}, agentTickMs);

void processNextAgentJob();
