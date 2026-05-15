import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle2,
  Clock3,
  FileVideo,
  Globe2,
  Hash,
  KeyRound,
  Link2,
  Lock,
  RefreshCcw,
  ShieldCheck,
  UploadCloud,
  WandSparkles,
  Youtube
} from 'lucide-react';
import { motion } from 'motion/react';

const mediaLibraries = [
  { name: 'BeautifulSoup', use: 'HTML parsing and page metadata scan', status: 'Installed' },
  { name: 'Playwright', use: 'Dynamic page scan with browser automation', status: 'Installed' },
  { name: 'MoviePy', use: 'Server-side trimming, stitching and render jobs', status: 'Installed' },
  { name: 'FFmpeg', use: 'Transcode, filters, captions and export pipeline', status: 'Installed' },
  { name: 'yt-dlp', use: 'Download only permitted source videos', status: 'Installed' },
];

const auditItems = [
  { label: 'YouTube kanal OAuth orqali ulanadi', status: 'Required', tone: 'amber' },
  { label: 'YouTube Data API v3 yoqiladi', status: 'Missing', tone: 'red' },
  { label: 'Gemini API metadata va script uchun ulanadi', status: 'Ready', tone: 'green' },
  { label: 'Video manbasi copyright-safe bo‘lishi kerak', status: 'Required', tone: 'amber' },
];

const monetizationChecks = [
  { label: '1,000 subscribers', value: '0 / 1,000', progress: 0 },
  { label: '4,000 public watch hours yoki Shorts talabi', value: '0%', progress: 0 },
  { label: 'Policy strikes', value: 'Tekshirilmagan', progress: 0 },
  { label: 'US audience potential', value: 'Data kerak', progress: 0 },
];

const workflowSteps = [
  'Trend va niche topish',
  'Ruxsatli video yoki asset tanlash',
  'AI script, title, description yozish',
  'Video qayta montaj, subtitle, hook qo‘shish',
  'Hashtag va schedule bilan YouTube upload'
];

interface ServerStatus {
  server: boolean;
  hasGeminiKey: boolean;
  hasYouTubeApiKey: boolean;
  hasYouTubeOAuthClient: boolean;
  youtubeConnected: boolean;
  redirectUri: string;
}

interface AgentStatus {
  running: boolean;
  mode: string;
  lastAction: string;
  startedAt: string | null;
  updatedAt: string;
  jobsCompleted: number;
  queueCount: number;
  logs: { at: string; message: string }[];
  error?: string;
}

export default function AdminPanel() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [agent, setAgent] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [sourceUploadStatus, setSourceUploadStatus] = useState('');

  async function loadStatus() {
    try {
      setStatusError('');
      const response = await fetch('/api/config/status');
      if (!response.ok) throw new Error('Backend server is not responding.');
      setStatus(await response.json());
    } catch (error) {
      setStatus(null);
      setStatusError(error instanceof Error ? error.message : 'Backend server is not responding.');
    }
  }

  async function loadAgentStatus() {
    const response = await fetch('/api/agent/status');
    setAgent(await response.json());
  }

  async function startAgent() {
    const response = await fetch('/api/agent/start', { method: 'POST' });
    const nextAgent = await response.json();
    setAgent(nextAgent);
  }

  async function pauseAgent() {
    const response = await fetch('/api/agent/pause', { method: 'POST' });
    setAgent(await response.json());
  }

  async function uploadSourceVideo(file?: File) {
    if (!file) return;
    setSourceUploadStatus('Uploading source video to agent queue...');
    const formData = new FormData();
    formData.append('video', file);
    const response = await fetch('/api/agent/source', {
      method: 'POST',
      body: formData,
    });
    const result = await response.json();
    if (!response.ok) {
      setSourceUploadStatus(result.error || 'Source upload failed.');
      return;
    }
    setSourceUploadStatus(`Queued: ${result.fileName}`);
    await loadAgentStatus();
  }

  async function disconnectYouTube() {
    await fetch('/auth/youtube/disconnect', { method: 'POST' });
    await loadStatus();
  }

  useEffect(() => {
    loadStatus();
    loadAgentStatus();
    const interval = window.setInterval(loadAgentStatus, 10000);
    return () => window.clearInterval(interval);
  }, []);

  const liveAuditItems = useMemo(() => [
    {
      label: 'YouTube kanal OAuth orqali ulanadi',
      status: status?.youtubeConnected ? 'Connected' : status?.hasYouTubeOAuthClient ? 'Ready to connect' : 'Client ID/Secret kerak',
      tone: status?.youtubeConnected ? 'green' : status?.hasYouTubeOAuthClient ? 'amber' : 'red',
    },
    {
      label: 'YouTube Data API v3 yoqiladi',
      status: status?.hasYouTubeApiKey ? 'API key configured' : 'API key missing',
      tone: status?.hasYouTubeApiKey ? 'green' : 'red',
    },
    {
      label: 'Gemini API metadata va script uchun ulanadi',
      status: status?.hasGeminiKey ? 'Ready' : 'Missing',
      tone: status?.hasGeminiKey ? 'green' : 'red',
    },
    { label: 'Video manbasi copyright-safe bo‘lishi kerak', status: 'Manual approval enabled', tone: 'amber' },
  ], [status]);

  return (
    <motion.div
      key="admin-panel"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="p-8 space-y-8 max-w-[1600px] mx-auto w-full"
    >
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-red-600/10 p-2 rounded-lg border border-red-500/20">
              <ShieldCheck className="w-5 h-5 text-red-500" />
            </div>
            <span className="text-xs font-bold text-red-500 uppercase tracking-widest">Admin Control Center</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight">YouTube Automation Admin</h1>
          <p className="text-zinc-500 mt-2 max-w-3xl">
            Kanal ulash, monetizatsiya imkoniyatini tekshirish, video pipeline va upload sozlamalarini boshqarish.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={loadStatus}
            className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-zinc-800 transition-all"
          >
            <RefreshCcw className="w-4 h-4" />
            Re-scan
          </button>
          {status?.youtubeConnected ? (
            <button
              onClick={disconnectYouTube}
              className="bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 transition-all"
            >
              <Youtube className="w-4 h-4" />
              Disconnect YouTube
            </button>
          ) : (
            <a
              href="/auth/youtube"
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-red-600/20 transition-all"
            >
              <Youtube className="w-4 h-4" />
              Connect YouTube
            </a>
          )}
        </div>
      </div>

      {statusError && (
        <div className="glass-panel p-4 rounded-2xl border-red-500/30 bg-red-500/10 text-sm text-red-200">
          Backend server topilmadi. `npm run dev:full` ni ishga tushiring yoki `npm run dev:server` ni alohida ko‘taring.
        </div>
      )}

      <section className="glass-panel p-6 rounded-2xl border-red-500/20 bg-gradient-to-br from-red-600/10 to-transparent">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-xl border ${agent?.running ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-zinc-900 border-zinc-800 text-red-500'}`}>
              <WandSparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="font-display font-bold text-xl text-white">AI Video Agent</h2>
                <span className={`text-[10px] font-mono uppercase tracking-widest px-3 py-1 rounded-full border ${
                  agent?.running
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                    : 'text-zinc-400 bg-zinc-900 border-zinc-800'
                }`}>
                  {agent?.running ? 'Running' : 'Paused'}
                </span>
              </div>
              <p className="text-sm text-zinc-400 max-w-3xl">
                {agent?.lastAction || 'AI agent status yuklanmoqda...'}
              </p>
              <p className="text-xs text-zinc-500 mt-2">
                Queue: {agent?.queueCount ?? 0} video • Completed: {agent?.jobsCompleted ?? 0} upload
              </p>
              {agent?.error && <p className="text-xs text-red-400 mt-2">{agent.error}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            {agent?.running ? (
              <button
                onClick={pauseAgent}
                className="bg-zinc-950 border border-zinc-800 hover:bg-zinc-900 text-white px-5 py-3 rounded-xl text-sm font-bold transition-all"
              >
                Pause AI
              </button>
            ) : (
              <button
                onClick={startAgent}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-3 rounded-xl text-sm font-bold shadow-lg shadow-red-600/20 transition-all"
              >
                Ishga tushirish
              </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 xl:grid-cols-3 gap-4">
          <label className="xl:col-span-1 block border border-dashed border-zinc-700 rounded-xl p-4 bg-zinc-950/40 hover:border-red-500/50 transition-all cursor-pointer">
            <input
              type="file"
              accept="video/*"
              className="sr-only"
              onChange={(event) => uploadSourceVideo(event.target.files?.[0])}
            />
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-red-600/10 text-red-500">
                <UploadCloud className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-white">Add source video</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">Agent edits and uploads private draft</p>
              </div>
            </div>
            {sourceUploadStatus && <p className="text-[10px] text-zinc-400 mt-3">{sourceUploadStatus}</p>}
          </label>

          <div className="xl:col-span-2 bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 max-h-40 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-bold text-white">Agent Logs</p>
              <button onClick={loadAgentStatus} className="text-[10px] text-zinc-500 hover:text-white">Refresh</button>
            </div>
            <div className="space-y-2">
              {(agent?.logs || []).slice(0, 8).map((log) => (
                <div key={`${log.at}-${log.message}`} className="text-[11px] text-zinc-400 flex gap-2">
                  <span className="text-zinc-600 font-mono shrink-0">{new Date(log.at).toLocaleTimeString()}</span>
                  <span>{log.message}</span>
                </div>
              ))}
              {!agent?.logs?.length && <p className="text-[11px] text-zinc-600">No agent logs yet.</p>}
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="glass-panel p-6 rounded-2xl xl:col-span-2">
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h2 className="font-display font-bold text-xl text-white">Account Readiness</h2>
              <p className="text-sm text-zinc-500 mt-1">Akkauntni xavfsiz ulash va daromadga tayyorligini tekshirish.</p>
            </div>
            <span className={
              status?.youtubeConnected
                ? 'text-[10px] font-mono uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full'
                : 'text-[10px] font-mono uppercase tracking-widest text-amber-400 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-full'
            }>
              {status?.youtubeConnected ? 'Connected' : 'OAuth needed'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(status ? liveAuditItems : auditItems).map((item) => (
              <div key={item.label} className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 flex items-start gap-3">
                <div className={
                  item.tone === 'green'
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : item.tone === 'red'
                      ? 'text-red-400 bg-red-500/10'
                      : 'text-amber-400 bg-amber-500/10'
                + ' p-2 rounded-lg'}>
                  {item.tone === 'green' ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-200">{item.label}</p>
                  <p className="text-xs text-zinc-500 mt-1">{item.status}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel p-6 rounded-2xl bg-gradient-to-br from-red-600/15 to-transparent border-red-500/20">
          <div className="flex items-center gap-3 mb-5">
            <div className="bg-red-600 p-2 rounded-lg">
              <BadgeDollarSign className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-display font-bold text-white">US Revenue Check</h2>
              <p className="text-[10px] text-zinc-400 font-mono uppercase tracking-widest">Needs channel data</p>
            </div>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed">
            AQSH auditoriyasidan ko‘proq RPM olish mumkin, lekin kanal mavzusi, tomosha va policy holati tekshirilgandan keyin aniq baho beriladi.
          </p>
          <button className="mt-5 w-full bg-white text-black py-2.5 rounded-xl font-bold text-xs hover:bg-zinc-200 transition-all">
            Run Monetization Audit
          </button>
        </section>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="glass-panel p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-5">
            <KeyRound className="w-5 h-5 text-red-500" />
            <h2 className="font-display font-bold text-white">API Credentials</h2>
          </div>
          <div className="space-y-4">
            {[
              { label: 'Gemini API Key', value: status?.hasGeminiKey ? 'Configured in .env.local' : 'Missing', icon: WandSparkles },
              { label: 'YouTube Client ID', value: status?.hasYouTubeOAuthClient ? 'Configured server-side' : 'Missing in .env.local', icon: Youtube },
              { label: 'YouTube Client Secret', value: status?.hasYouTubeOAuthClient ? 'Stored server-side only' : 'Missing in .env.local', icon: Lock },
              { label: 'Redirect URL', value: status?.redirectUri || 'http://localhost:8787/auth/youtube/callback', icon: Link2 },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3 p-3 bg-zinc-950/50 rounded-xl border border-zinc-800">
                <item.icon className="w-4 h-4 text-zinc-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-zinc-300">{item.label}</p>
                  <p className="text-[11px] text-zinc-500 truncate">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-5">
            <Globe2 className="w-5 h-5 text-red-500" />
            <h2 className="font-display font-bold text-white">Monetization Gates</h2>
          </div>
          <div className="space-y-5">
            {monetizationChecks.map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="text-xs font-semibold text-zinc-300">{item.label}</span>
                  <span className="text-[11px] font-mono text-zinc-500">{item.value}</span>
                </div>
                <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-red-600 rounded-full" style={{ width: `${item.progress}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel p-6 rounded-2xl">
          <div className="flex items-center gap-3 mb-5">
            <UploadCloud className="w-5 h-5 text-red-500" />
            <h2 className="font-display font-bold text-white">Upload Defaults</h2>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Visibility</p>
                <p className="text-sm text-white mt-1">Public upload</p>
              </div>
              <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
                <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Format</p>
                <p className="text-sm text-white mt-1">Shorts</p>
              </div>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Default Hashtags</p>
              <p className="text-sm text-white mt-1">#shorts #ai #creator #viral</p>
            </div>
            <div className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Schedule</p>
              <p className="text-sm text-white mt-1">Auto publish when agent is running</p>
            </div>
          </div>
        </section>
      </div>

      <section className="glass-panel p-6 rounded-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display font-bold text-xl text-white">Automation Pipeline</h2>
            <p className="text-sm text-zinc-500 mt-1">Video topishdan YouTube uploadgacha bo‘lgan nazoratli jarayon.</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <Clock3 className="w-4 h-4" />
            Approval mode enabled
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {workflowSteps.map((step, index) => (
            <div key={step} className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 min-h-32 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-zinc-500">STEP {index + 1}</span>
                {index === 0 ? <Hash className="w-4 h-4 text-red-500" /> : index === 1 ? <FileVideo className="w-4 h-4 text-red-500" /> : <WandSparkles className="w-4 h-4 text-red-500" />}
              </div>
              <p className="text-sm font-semibold text-zinc-200 leading-snug">{step}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-panel p-6 rounded-2xl">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="font-display font-bold text-xl text-white">Media Toolchain</h2>
            <p className="text-sm text-zinc-500 mt-1">Scraping, source handling and advanced edit libraries connected to the project.</p>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
            Python stack ready
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {mediaLibraries.map((library) => (
            <div key={library.name} className="bg-zinc-950/50 border border-zinc-800 rounded-xl p-4 min-h-36 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-display font-bold text-white">{library.name}</p>
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              </div>
              <p className="text-xs text-zinc-500 leading-relaxed">{library.use}</p>
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400">{library.status}</span>
            </div>
          ))}
        </div>
      </section>
    </motion.div>
  );
}
