import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
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

app.get('/api/config/status', (_req, res) => {
  res.json(getStatus());
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
