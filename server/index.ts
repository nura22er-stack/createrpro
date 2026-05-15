import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
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
const voiceDir = path.join(dataDir, 'voice');
const sourceDir = path.resolve('uploads/source');
const processingDir = path.resolve('uploads/processing');
const processedDir = path.resolve('uploads/processed');
const failedDir = path.resolve('uploads/failed');
const distDir = path.resolve('dist');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 * 1024 } });

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

function listSourceVideos() {
  ensureDataDir();
  const allowed = new Set(['.mp4', '.mov', '.webm', '.mkv']);
  return fs
    .readdirSync(sourceDir)
    .filter((name) => allowed.has(path.extname(name).toLowerCase()))
    .map((name) => path.join(sourceDir, name));
}

function safeFileName(name: string) {
  const extension = path.extname(name) || '.mp4';
  const base = path.basename(name, extension).replace(/[^a-z0-9-_]+/gi, '-').slice(0, 80) || 'source-video';
  return `${Date.now()}-${base}${extension.toLowerCase()}`;
}

function runFfmpeg(inputPath: string, outputPath: string) {
  return new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      inputPath,
      '-t',
      '60',
      '-vf',
      'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,eq=contrast=1.08:saturation=1.18,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
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
  const topic = profile.niche || 'AI automation';
  const titleSeed = path.basename(sourcePath, path.extname(sourcePath)).replace(/[-_]+/g, ' ');
  const title = `${titleSeed} | ${topic} #shorts`.slice(0, 100);

  return {
    title,
    description: [
      `AI edited and uploaded by Creator Pro Dashboard.`,
      `Topic: ${topic}`,
      `Language: ${profile.language || 'Uzbek'}`,
      '',
      '#shorts #ai #creatorpro',
    ].join('\n'),
    tags: ['shorts', 'ai', 'creatorpro', String(topic).toLowerCase()].filter(Boolean),
  };
}

async function uploadVideoPath(videoPath: string, metadata: { title: string; description: string; tags: string[] }) {
  const client = getOAuthClient();

  if (!client || !fs.existsSync(tokenPath)) {
    throw new Error('YouTube account is not connected.');
  }

  const youtube = google.youtube({ version: 'v3', auth: client });
  const response = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: '22',
      },
      status: {
        privacyStatus: 'private',
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

async function processNextAgentJob() {
  const state = readAgentState();
  if (!state.running || agentWorking) return;

  const [nextSource] = listSourceVideos();
  if (!nextSource) {
    writeAgentState({ lastAction: 'AI agent is running. Waiting for source videos in uploads/source.' });
    return;
  }

  agentWorking = true;
  const processingPath = path.join(processingDir, path.basename(nextSource));
  const outputPath = path.join(processedDir, `${path.basename(nextSource, path.extname(nextSource))}-short.mp4`);

  try {
    fs.renameSync(nextSource, processingPath);
    appendAgentLog(`Started editing ${path.basename(processingPath)}.`);
    writeAgentState({ mode: 'editing', lastAction: `Editing ${path.basename(processingPath)} with FFmpeg.` });

    await runFfmpeg(processingPath, outputPath);

    const metadata = buildUploadMetadata(processingPath);
    appendAgentLog(`Uploading ${path.basename(outputPath)} to YouTube as private.`);
    writeAgentState({ mode: 'uploading', lastAction: `Uploading ${metadata.title}` });

    const videoId = await uploadVideoPath(outputPath, metadata);
    appendAgentLog(`Uploaded private video to YouTube. Video ID: ${videoId}`);
    fs.rmSync(processingPath, { force: true });
    writeAgentState({
      mode: 'running',
      jobsCompleted: Number(state.jobsCompleted || 0) + 1,
      lastAction: `Uploaded private video. Video ID: ${videoId}`,
      error: '',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    appendAgentLog(`Worker error: ${message}`);
    if (fs.existsSync(processingPath)) {
      fs.renameSync(processingPath, path.join(failedDir, path.basename(processingPath)));
    }
    writeAgentState({ mode: 'error', running: false, lastAction: 'AI agent paused after an error.', error: message });
  } finally {
    agentWorking = false;
  }
}

app.get('/api/config/status', (_req, res) => {
  res.json(getStatus());
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

app.get('/api/agent/status', (_req, res) => {
  res.json(readAgentState());
});

app.post('/api/agent/start', (_req, res) => {
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
    lastAction: 'AI agent started. Scanning source queue, editing videos, and uploading private drafts.',
    error: '',
  });
  appendAgentLog('AI agent started by admin.');
  void processNextAgentJob();

  res.json(state);
});

app.post('/api/agent/pause', (_req, res) => {
  const state = writeAgentState({
    running: false,
    mode: 'paused',
    lastAction: 'AI agent paused by admin.',
  });
  appendAgentLog('AI agent paused by admin.');

  res.json(state);
});

app.post('/api/agent/source', upload.single('video'), (req, res) => {
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

app.get('/api/profile', (_req, res) => {
  if (!fs.existsSync(profilePath)) {
    res.json({});
    return;
  }

  res.json(JSON.parse(fs.readFileSync(profilePath, 'utf8')));
});

app.put('/api/profile', (req, res) => {
  ensureDataDir();
  fs.writeFileSync(profilePath, JSON.stringify(req.body || {}, null, 2));
  res.json({ ok: true, profile: req.body || {} });
});

app.get('/auth/youtube', (_req, res) => {
  const client = getOAuthClient();

  if (!client) {
    res.status(400).send('YOUTUBE_CLIENT_ID va YOUTUBE_CLIENT_SECRET .env.local ichiga kiritilmagan.');
    return;
  }

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/yt-analytics.readonly',
    ],
  });

  res.redirect(url);
});

app.get('/auth/youtube/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const client = getOAuthClient();

  if (!client || !code) {
    res.status(400).send('OAuth callback failed.');
    return;
  }

  const { tokens } = await client.getToken(code);
  ensureDataDir();
  fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
  res.redirect(`${process.env.APP_URL || 'http://localhost:3001'}?youtube=connected`);
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

app.post('/auth/youtube/disconnect', (_req, res) => {
  if (fs.existsSync(tokenPath)) {
    fs.unlinkSync(tokenPath);
  }

  res.json({ ok: true });
});

app.get('/api/youtube/channel', async (_req, res) => {
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

app.post('/api/youtube/upload', upload.single('video'), async (req, res) => {
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
}, 30000);

void processNextAgentJob();
