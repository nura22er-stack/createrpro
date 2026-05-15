import express from 'express';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import multer from 'multer';
import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = Number(process.env.SERVER_PORT || 8787);
const dataDir = path.resolve('.data');
const tokenPath = path.join(dataDir, 'youtube-token.json');
const profilePath = path.join(dataDir, 'profile.json');
const agentPath = path.join(dataDir, 'agent.json');
const agentLogPath = path.join(dataDir, 'agent-log.json');
const agentSourceCursorPath = path.join(dataDir, 'agent-source-cursor.json');
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
const adminEmail = (process.env.ADMIN_EMAIL || 'm6dhhjffu@gmail.com').toLowerCase();
const sessionCookieName = 'creator_pro_admin';
const agentSourceMaxBytes = Number(process.env.AGENT_SOURCE_MAX_BYTES || 280 * 1024 * 1024);
const archiveComedyIdentifiers = [
  'eddie_cantor_1923',
  'the-sawmill',
  'silent-his-musical-career',
  'his-musical-career-1914',
  'his-musical-career-1914-directed-by-charles-chaplin',
];

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
    };
  }

  return {
    ...JSON.parse(fs.readFileSync(agentPath, 'utf8')),
    queueCount: listSourceVideos().length,
    logs: readAgentLogs(),
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

function getNextAgentSourceUrl() {
  const urls = readAgentSourceUrls();
  if (!urls.length) return null;

  const cursor = readAgentSourceCursor();
  const url = urls[cursor % urls.length];
  writeAgentSourceCursor(cursor + 1);
  return url;
}

async function getInternetArchiveDownloadUrl(identifier: string) {
  const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, {
    headers: { 'User-Agent': 'CreatorProDashboard/1.0 (public-domain comedy discovery)' },
  });

  if (!response.ok) {
    throw new Error(`Internet Archive metadata failed with ${response.status}`);
  }

  const data = await response.json();
  const files = (data.files || []) as Array<{ name?: string; format?: string; size?: string }>;
  const videoFile = files
    .filter((file) => /\.(mp4|webm|ogv)$/i.test(file.name || ''))
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

  appendAgentLog(`Selected public-domain comedy source: ${data.metadata?.title || identifier}`);
  return `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(videoFile.name)}`;
}

async function discoverInternetArchiveComedySourceUrl() {
  const cursor = readAgentSourceCursor();
  const preferredIdentifiers = String(process.env.AGENT_ARCHIVE_COMEDY_IDS || '')
    .split(/[\n,]+/)
    .map((identifier) => identifier.trim())
    .filter(Boolean);
  const identifiers = preferredIdentifiers.length ? preferredIdentifiers : archiveComedyIdentifiers;

  for (let index = 0; index < identifiers.length; index += 1) {
    const identifier = identifiers[(cursor + index) % identifiers.length];
    try {
      const sourceUrl = await getInternetArchiveDownloadUrl(identifier);
      if (sourceUrl) {
        writeAgentSourceCursor(cursor + index + 1);
        return sourceUrl;
      }
    } catch (error) {
      appendAgentLog(`Internet Archive source skipped: ${identifier} (${error instanceof Error ? error.message : 'unknown error'})`);
    }
  }

  return null;
}

async function discoverWikimediaSourceUrl() {
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
      return info?.url && info.mime?.startsWith('video/') && (license.includes('cc0') || license.includes('public domain') || license.includes('pdm'));
    });

    if (safeVideo?.imageinfo?.[0]?.url) {
      writeAgentSourceCursor(cursor + 20);
      appendAgentLog(`Discovered rights-safe Wikimedia source: ${safeVideo.title || safeVideo.imageinfo[0].url}`);
      return safeVideo.imageinfo[0].url;
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

async function downloadDirectSource(url: string, destination: string) {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Source download failed with ${response.status}`);
  }

  await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(destination));
}

async function queueSourceFromUrl() {
  const sourceUrl = getNextAgentSourceUrl() || (await discoverInternetArchiveComedySourceUrl()) || (await discoverWikimediaSourceUrl());

  if (!sourceUrl) {
    return null;
  }

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

function runFfmpeg(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-f',
      'lavfi',
      '-t',
      String(agentShortDuration),
      '-i',
      `sine=frequency=440:beep_factor=4:sample_rate=44100:duration=${agentShortDuration},volume=0.06`,
      '-t',
      String(agentShortDuration),
      '-vf',
      `scale=${agentOutputWidth}:${agentOutputHeight}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${agentOutputWidth}:${agentOutputHeight}:(ow-iw)/2:(oh-ih)/2:black,unsharp=5:5:0.55:3:3:0.25,eq=contrast=1.06:saturation=1.12,setsar=1,format=yuv420p`,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
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
    const child = spawn('ffmpeg', args);
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
  const topic = profile.niche || 'funny shorts';
  const titleSeed = path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, ' ');
  const hooks = [
    'Wait for the unexpected ending',
    'This old comedy moment still works',
    'The timing is perfect',
    'Vintage comedy in 18 seconds',
    'This silent comedy bit is wild',
    'A quick laugh before you scroll',
  ];
  const hook = hooks[Math.abs(titleSeed.length + new Date().getMinutes()) % hooks.length];
  const title = `${hook} | ${topic} #shorts`.slice(0, 100);

  return {
    title,
    description: [
      `Short, AI-edited public-domain/rights-safe clip uploaded by Creator Pro Dashboard.`,
      `If this made you smile, like and subscribe for more daily comedy shorts.`,
      `Topic: ${topic}`,
      `Language: ${profile.language || 'Uzbek'}`,
      '',
      '#shorts #funny #comedy #viral #trending #fyp #creatorpro',
    ].join('\n'),
    tags: ['shorts', 'funny', 'comedy', 'viral', 'trending', 'fyp', 'creatorpro', String(topic).toLowerCase()].filter(Boolean),
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

function getNextAgentRunAt(lastUploadAt?: unknown) {
  const lastUploadTime = lastUploadAt ? new Date(String(lastUploadAt)).getTime() : 0;
  if (!lastUploadTime) return new Date().toISOString();

  return new Date(lastUploadTime + agentUploadIntervalMs).toISOString();
}

function shouldWaitForNextUpload(lastUploadAt?: unknown) {
  const lastUploadTime = lastUploadAt ? new Date(String(lastUploadAt)).getTime() : 0;
  return Boolean(lastUploadTime && Date.now() - lastUploadTime < agentUploadIntervalMs);
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

  const lastCycleAt = state.lastAttemptAt || state.lastUploadAt;
  if (shouldWaitForNextUpload(lastCycleAt)) {
    writeAgentState({
      mode: 'running',
      nextRunAt: getNextAgentRunAt(lastCycleAt),
      lastAction: `AI agent is running. Next upload window: ${getNextAgentRunAt(lastCycleAt)}.`,
    });
    return;
  }

  agentWorking = true;
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

    await runFfmpeg(processingPath, outputPath);

    const metadata = buildUploadMetadata(processingPath);
    appendAgentLog(`Uploading ${path.basename(outputPath)} to YouTube as ${process.env.AGENT_PRIVACY_STATUS || 'public'}.`);
    writeAgentState({ mode: 'uploading', lastAction: `Uploading ${metadata.title}` });

    const videoId = await uploadVideoPath(outputPath, metadata);
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

app.get('/api/agent/status', requireAdmin, (_req, res) => {
  res.json(readAgentState());
});

app.post('/api/agent/start', requireAdmin, (_req, res) => {
  if (!fs.existsSync(tokenPath)) {
    res.status(409).json({
      error: 'YouTube account is not connected. Connect YouTube before starting the AI agent.',
    });
    return;
  }

  const state = writeAgentState({
    running: true,
    mode: 'running',
    startedAt: new Date().toISOString(),
    nextRunAt: getNextAgentRunAt(readAgentState().lastUploadAt),
    lastAction: `AI agent started. It will upload up to ${agentDailyUploadLimit} public videos per day.`,
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
    prompt: 'select_account',
    state: 'admin-login',
    scope: ['openid', 'email', 'profile'],
  });

  res.redirect(url);
});

app.post('/auth/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/auth/youtube', (req, res) => {
  if (!isAdminRequest(req)) {
    res.redirect('/?auth=required');
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
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ],
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

    res.setHeader('Set-Cookie', `${sessionCookieName}=${encodeURIComponent(signSession(email))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
    res.redirect(`${getAppUrl()}?admin=connected`);
    return;
  }

  if (!isAdminRequest(req)) {
    res.redirect('/?auth=required');
    return;
  }

  ensureDataDir();
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  res.redirect(`${getAppUrl()}?youtube=connected`);
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
