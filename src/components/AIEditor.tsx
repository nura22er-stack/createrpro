import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Cpu, 
  Globe, 
  MapPin, 
  Gamepad2, 
  ShieldCheck, 
  Sparkles, 
  Scissors, 
  Type, 
  Wand2, 
  Play, 
  Pause, 
  RotateCcw, 
  Plus, 
  Settings2,
  Video,
  Languages,
  Zap,
  UploadCloud,
  Download,
  Loader2,
  SlidersHorizontal
} from 'lucide-react';
import { cn } from '../lib/utils';
import { renderEditedVideo } from '../lib/videoEditor';

interface AgentMedia {
  stage: string;
  fileName: string;
  url: string;
  updatedAt: string;
}

interface AgentStatus {
  running: boolean;
  mode: string;
  lastAction: string;
  media?: AgentMedia;
  error?: string;
}

export default function AIEditor() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(35);
  const [activeNiche, setActiveNiche] = useState('usa');
  const [aiStatus, setAiStatus] = useState('Analysing viral hooks...');
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [renderedUrl, setRenderedUrl] = useState('');
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);
  const [contrast, setContrast] = useState(1.08);
  const [saturation, setSaturation] = useState(1.18);
  const [addShortsFrame, setAddShortsFrame] = useState(true);
  const [renderProgress, setRenderProgress] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [projectMode, setProjectMode] = useState<'draft' | 'shared'>('draft');
  const [uploadTitle, setUploadTitle] = useState('Creator Pro edited short');
  const [uploadTags, setUploadTags] = useState('#shorts, #ai, #creator');
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus | null>(null);
  const [agentError, setAgentError] = useState('');
  const [isStartingAgent, setIsStartingAgent] = useState(false);

  const agentMedia = agentStatus?.media?.url ? agentStatus.media : null;
  const previewVideoUrl = renderedUrl || previewUrl || agentMedia?.url || '';
  const canUploadVideo = Boolean(renderedUrl || sourceFile || agentMedia?.url);

  useEffect(() => {
    const statuses = [
      'Analysing viral hooks...',
      'Applying jump cuts...',
      'Generating dynamic subtitles...',
      'Enhancing cinematic color...',
      'Matching audio rhythm...',
      'Agent AI: Finalizing export...'
    ];
    let i = 0;
    const interval = setInterval(() => {
      setAiStatus(statuses[i]);
      i = (i + 1) % statuses.length;
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    };
  }, [previewUrl, renderedUrl]);

  async function loadAgentStatus() {
    try {
      const response = await fetch('/api/agent/status');
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          const publicResponse = await fetch('/api/agent/public-media');
          const publicData = await publicResponse.json();
          if (publicResponse.ok) {
            setAgentStatus(publicData);
            setAgentError('Google bilan kiring: preview ko‘rinadi, upload uchun YouTube ruxsati kerak.');
            return;
          }
        }
        throw new Error(data.error || 'AI agent status unavailable.');
      }

      setAgentStatus(data);
      setAgentError('');
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'AI agent status unavailable.');
    }
  }

  useEffect(() => {
    void loadAgentStatus();
    const interval = window.setInterval(loadAgentStatus, 5000);
    return () => window.clearInterval(interval);
  }, []);

  async function startAgentUpload() {
    setIsStartingAgent(true);
    setAgentError('');

    try {
      const response = await fetch('/api/agent/start', { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401 && data?.loginUrl) {
          window.location.href = data.loginUrl;
          return;
        }
        if (data?.media) {
          setAgentStatus(data);
          setUploadStatus(data.error || 'AI draft is ready. Connect YouTube to upload it to the channel.');
        }
        throw new Error(data.error || 'AI agent could not start.');
      }

      setAgentStatus(data);
      setUploadStatus('AI agent started. The generated/edited video will appear here while it works.');
      await loadAgentStatus();
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : 'AI agent could not start.');
    } finally {
      setIsStartingAgent(false);
    }
  }

  function handleSourceFile(file?: File) {
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (renderedUrl) URL.revokeObjectURL(renderedUrl);
    setSourceFile(file);
    setRenderedUrl('');
    setRenderError('');
    setPreviewUrl(URL.createObjectURL(file));
  }

  async function handleRender() {
    if (!sourceFile || isRendering) return;

    setIsRendering(true);
    setRenderError('');
    setRenderProgress(0);

    try {
      const url = await renderEditedVideo({
        file: sourceFile,
        start: trimStart,
        end: trimEnd,
        contrast,
        saturation,
        addShortsFrame,
        onProgress: setRenderProgress,
      });

      if (renderedUrl) URL.revokeObjectURL(renderedUrl);
      setRenderedUrl(url);
      setRenderProgress(100);
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : 'Video render failed.');
    } finally {
      setIsRendering(false);
    }
  }

  async function handleYouTubeUpload() {
    if (!canUploadVideo || isUploading) return;

    setIsUploading(true);
    setUploadStatus('Uploading...');

    try {
      const formData = new FormData();

      if (renderedUrl) {
        const blob = await fetch(renderedUrl).then((response) => response.blob());
        formData.append('video', blob, 'creator-pro-edited.mp4');
      } else if (sourceFile) {
        formData.append('video', sourceFile);
      } else if (agentMedia?.url) {
        const blob = await fetch(agentMedia.url).then((response) => response.blob());
        formData.append('video', blob, agentMedia.fileName || 'creator-pro-agent.mp4');
      }

      formData.append('title', uploadTitle);
      formData.append('description', 'Uploaded from Creator Pro Dashboard after manual approval.');
      formData.append('tags', uploadTags);
      formData.append('privacyStatus', 'private');

      const response = await fetch('/api/youtube/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Upload failed.');
      }

      setUploadStatus(`Uploaded privately. Video ID: ${result.videoId}`);
    } catch (error) {
      setUploadStatus(error instanceof Error ? error.message : 'Upload failed.');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-zinc-950">
      {/* Editor Header */}
      <div className="h-14 border-b border-zinc-800/50 flex items-center justify-between px-6 bg-zinc-900/30">
        <div className="flex items-center gap-6">
          <h2 className="font-display font-bold text-sm tracking-widest text-zinc-400 uppercase">Project: Viral_AI_Short_01</h2>
          <div className="flex items-center gap-2 px-3 py-1 bg-zinc-800 rounded-full border border-zinc-700">
            <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
            <span className="text-[10px] font-mono text-emerald-500 font-bold uppercase tracking-tight">AI Agent Active</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1 bg-zinc-900 p-1 rounded-lg border border-zinc-800">
            <button
              onClick={() => setProjectMode('draft')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-md shadow-sm ${projectMode === 'draft' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              Draft
            </button>
            <button
              onClick={() => setProjectMode('shared')}
              className={`px-3 py-1.5 text-[10px] font-bold rounded-md shadow-sm ${projectMode === 'shared' ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}
            >
              Shared
            </button>
          </div>
          <button
            onClick={handleYouTubeUpload}
            disabled={!canUploadVideo || isUploading}
            className="bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-500 hover:bg-red-700 text-white px-4 py-1.5 rounded-lg text-xs font-bold shadow-lg shadow-red-600/20 transition-all flex items-center gap-2"
          >
            Finish & Post
            <Zap className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel: Niche Selection */}
        <div className="w-64 border-r border-zinc-800/50 flex flex-col p-4 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-bold text-white tracking-tight">Target Niche</h3>
            </div>
            <div className="space-y-2">
              {[
                { id: 'usa', name: 'USA Viral', icon: Globe, trending: true },
                { id: 'gaming', name: 'Gaming Pro', icon: Gamepad2, trending: true },
                { id: 'tech', name: 'Tech Reviews', icon: Cpu, trending: false },
                { id: 'asmr', name: 'ASMR Studio', icon: Wand2, trending: false },
              ].map((niche) => (
                <button
                  key={niche.id}
                  onClick={() => setActiveNiche(niche.id)}
                  className={cn(
                    "w-full flex items-center justify-between p-3 rounded-xl transition-all border",
                    activeNiche === niche.id 
                      ? "bg-red-600/10 border-red-500/50 text-white shadow-lg shadow-red-600/5" 
                      : "bg-zinc-900/50 border-zinc-800/50 text-zinc-400 hover:border-zinc-700"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <niche.icon className={cn("w-4 h-4", activeNiche === niche.id ? "text-red-500" : "text-zinc-500")} />
                    <span className="text-xs font-medium">{niche.name}</span>
                  </div>
                  {niche.trending && (
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <h3 className="text-sm font-bold text-white tracking-tight">Copyright Scan</h3>
            </div>
            <div className="bg-zinc-900/80 rounded-xl p-4 border border-emerald-500/20">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Safe Score</span>
                <span className="text-[10px] font-mono text-emerald-400 font-bold">98% CLEAR</span>
              </div>
              <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                <motion.div initial={{ width: 0 }} animate={{ width: '98%' }} className="h-full bg-emerald-500" />
              </div>
            </div>
          </div>
        </div>

        {/* Main Editor Center */}
        <div className="flex-1 flex flex-col bg-zinc-900/20 relative">
          {/* AI Activity Overlay */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              key={aiStatus}
              className="bg-zinc-950/80 backdrop-blur-md border border-red-500/30 px-6 py-2 rounded-full flex items-center gap-3 shadow-2xl shadow-red-500/10"
            >
              <div className="flex gap-1 relative h-3 w-4 items-center justify-center">
                <motion.span animate={{ height: [4, 12, 4] }} transition={{ repeat: Infinity, duration: 1 }} className="w-0.5 bg-red-500" />
                <motion.span animate={{ height: [8, 4, 8] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-0.5 bg-red-500" />
                <motion.span animate={{ height: [4, 10, 4] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-0.5 bg-red-500" />
              </div>
              <span className="text-xs font-mono font-medium text-white tracking-wide">{aiStatus}</span>
            </motion.div>
          </div>

          <div className="flex-1 p-6 flex items-center justify-center relative">
            <div className="w-full max-w-4xl aspect-video rounded-3xl overflow-hidden bg-black shadow-[0_0_100px_rgba(255,0,0,0.1)] border border-zinc-800 relative group">
              {previewVideoUrl ? (
                <video
                  key={previewVideoUrl}
                  src={previewVideoUrl}
                  className="w-full h-full object-cover opacity-80"
                  controls
                />
              ) : (
                <img 
                  src="https://images.unsplash.com/photo-1677442136019-21780ecad995?w=1600&auto=format&fit=crop&q=80" 
                  className="w-full h-full object-cover opacity-60 mix-blend-luminosity"
                  alt="Video preview"
                  referrerPolicy="no-referrer"
                />
              )}
              
              {/* Dynamic Subtitles Overlays */}
              <div className="absolute bottom-12 left-0 right-0 text-center px-20">
                <AnimatePresence mode="wait">
                  <motion.div
                    key={aiStatus}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 1.1, opacity: 0 }}
                    className="inline-block"
                  >
                    <span className="bg-red-600 text-white px-4 py-2 text-2xl font-display font-black uppercase italic tracking-tighter shadow-lg transform -skew-x-12">
                      {aiStatus.split('...')[0]}
                    </span>
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Viewport Play Controls */}
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                <button 
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-2xl scale-90 group-hover:scale-100 transition-transform"
                >
                  {isPlaying ? <Pause className="w-8 h-8 text-white fill-current" /> : <Play className="w-8 h-8 text-white fill-current ml-1" />}
                </button>
              </div>
            </div>
          </div>

          {/* Timeline Container */}
          <div className="h-[280px] border-t border-zinc-800/50 bg-black/40 flex flex-col">
            <div className="h-10 border-b border-zinc-800/30 flex items-center justify-between px-4">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <button className="p-1.5 text-zinc-500 hover:text-white transition-colors" onClick={() => setIsPlaying(!isPlaying)}>
                    {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  </button>
                  <button
                    onClick={() => {
                      setProgress(0);
                      setIsPlaying(false);
                    }}
                    className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
                <div className="text-[10px] font-mono text-zinc-500 space-x-1">
                  <span className="text-white">00:00:12:45</span>
                  <span>/</span>
                  <span>00:01:00:00</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900 rounded border border-zinc-800 text-[10px] font-mono font-bold text-zinc-400">
                  FPS <span className="text-white">60</span>
                </div>
                <div className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900 rounded border border-zinc-800 text-[10px] font-mono font-bold text-zinc-400">
                  4K <span className="text-white">HDR</span>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-x-auto relative scrollbar-hide">
              {/* Playhead */}
              <div 
                className="absolute top-0 bottom-0 w-px bg-red-600 z-20 shadow-[0_0_10px_rgba(255,0,0,0.8)]"
                style={{ left: `${progress}%` }}
              >
                <div className="absolute top-0 -left-1.5 w-3 h-3 bg-red-600 rotate-45" />
              </div>

              {/* Tracks */}
              <div className="p-4 space-y-3 min-w-[1200px]">
                {/* AI Agent Track */}
                <div className="flex gap-4 items-center">
                  <div className="w-24 shrink-0 flex items-center gap-2 text-[10px] font-bold text-red-500 uppercase tracking-widest">
                    <Sparkles className="w-3 h-3" />
                    AI Agent
                  </div>
                  <div className="flex-1 h-8 bg-red-600/5 border border-red-500/20 rounded-lg relative overflow-hidden">
                   <div className="absolute top-0 left-0 bottom-0 bg-red-600/20 blur-sm" style={{ width: `${progress}%` }} />
                   <div className="absolute top-0 left-[10%] w-[15%] h-full bg-red-600/10 flex items-center px-3 border-x border-red-500/10">
                    <span className="text-[8px] font-mono text-red-400">HOOK ANALYSIS</span>
                   </div>
                   <div className="absolute top-0 left-[35%] w-[10%] h-full bg-red-600/20 flex items-center px-3 border-x border-red-500/30">
                    <span className="text-[8px] font-mono text-red-200">AUTO CUTS</span>
                   </div>
                  </div>
                </div>

                {/* Video Track */}
                <div className="flex gap-4 items-center">
                  <div className="w-24 shrink-0 flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    <Video className="w-3 h-3" />
                    Video 1
                  </div>
                  <div className="flex-1 h-8 bg-zinc-900 border border-zinc-800 rounded-lg flex gap-1 overflow-hidden">
                    <div className="w-[30%] h-full bg-zinc-800 flex items-center px-4 border-r border-zinc-700">
                      <span className="text-[9px] text-zinc-500 truncate">Intro_Clip.mp4</span>
                    </div>
                    <div className="w-[40%] h-full bg-zinc-800 flex items-center px-4 border-r border-zinc-700 relative">
                      <span className="text-[9px] text-zinc-500 truncate">Main_Hook_01.mp4</span>
                      <div className="absolute top-0 left-0 bottom-0 w-2 bg-gradient-to-r from-red-600/40 to-transparent" />
                    </div>
                    <div className="w-[30%] h-full bg-zinc-800 flex items-center px-4">
                      <span className="text-[9px] text-zinc-500 truncate">Outro_Render.mp4</span>
                    </div>
                  </div>
                </div>

                {/* Subtitle Track */}
                <div className="flex gap-4 items-center">
                  <div className="w-24 shrink-0 flex items-center gap-2 text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                    <Type className="w-3 h-3" />
                    Captions
                  </div>
                  <div className="flex-1 h-8 flex gap-2">
                    {[10, 15, 20, 12, 18, 15, 10].map((w, i) => (
                      <div 
                        key={i} 
                        className="h-full bg-zinc-800/40 border border-zinc-700/50 rounded-md flex items-center px-3 group hover:border-red-500/50 transition-colors"
                        style={{ width: `${w}%` }}
                      >
                        <span className="text-[8px] font-mono text-zinc-500 group-hover:text-zinc-300">SEG_{i+1}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Language/Global */}
        <div className="w-72 border-l border-zinc-800/50 flex flex-col p-4 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Scissors className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-bold text-white tracking-tight">Render Engine</h3>
            </div>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white">AI Agent Video</p>
                  <p className="text-[10px] text-zinc-500 mt-1 line-clamp-2">
                    {agentStatus?.lastAction || agentError || 'AI agent status yuklanmoqda...'}
                  </p>
                </div>
                <span className={cn(
                  "text-[9px] font-mono uppercase px-2 py-1 rounded-full border shrink-0",
                  agentStatus?.running ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/20" : "text-zinc-400 bg-zinc-950 border-zinc-800"
                )}>
                  {agentStatus?.running ? 'running' : 'paused'}
                </span>
              </div>
              {agentMedia?.url && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{agentMedia.stage}</p>
                  <p className="text-xs text-zinc-200 truncate mt-1">{agentMedia.fileName}</p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={startAgentUpload}
                  disabled={isStartingAgent}
                  className="bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-500 hover:bg-red-700 text-white py-2.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                >
                  {isStartingAgent ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                  Start AI
                </button>
                <button
                  onClick={loadAgentStatus}
                  className="bg-zinc-950 border border-zinc-800 hover:bg-zinc-800 text-zinc-300 py-2.5 rounded-lg text-xs font-bold transition-all"
                >
                  Refresh
                </button>
              </div>
              {agentError && <p className="text-[10px] leading-relaxed text-amber-300">{agentError}</p>}
            </div>

            <label className="block border border-dashed border-zinc-700 rounded-xl p-4 bg-zinc-900/40 hover:border-red-500/50 transition-all cursor-pointer">
              <input
                type="file"
                accept="video/*"
                className="sr-only"
                onChange={(event) => handleSourceFile(event.target.files?.[0])}
              />
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-red-600/10 text-red-500">
                  <UploadCloud className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{sourceFile ? sourceFile.name : 'Upload video source'}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">MP4, MOV, WEBM</p>
                </div>
              </div>
            </label>

            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-zinc-500" />
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">Cut & Polish</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase">Start</span>
                  <input
                    type="number"
                    min="0"
                    value={trimStart}
                    onChange={(event) => setTrimStart(Number(event.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase">End</span>
                  <input
                    type="number"
                    min="1"
                    value={trimEnd}
                    onChange={(event) => setTrimEnd(Number(event.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                  />
                </label>
              </div>

              <label className="space-y-2 block">
                <div className="flex justify-between text-[10px] text-zinc-500 font-bold uppercase">
                  <span>Contrast</span>
                  <span>{contrast.toFixed(2)}</span>
                </div>
                <input type="range" min="0.8" max="1.5" step="0.01" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} className="w-full accent-red-600" />
              </label>

              <label className="space-y-2 block">
                <div className="flex justify-between text-[10px] text-zinc-500 font-bold uppercase">
                  <span>Saturation</span>
                  <span>{saturation.toFixed(2)}</span>
                </div>
                <input type="range" min="0.6" max="1.8" step="0.01" value={saturation} onChange={(event) => setSaturation(Number(event.target.value))} className="w-full accent-red-600" />
              </label>

              <button
                onClick={() => setAddShortsFrame(!addShortsFrame)}
                className={cn(
                  "w-full flex items-center justify-between p-3 rounded-xl border text-xs font-bold transition-all",
                  addShortsFrame ? "bg-red-600/10 border-red-500/30 text-white" : "bg-zinc-950 border-zinc-800 text-zinc-500"
                )}
              >
                Shorts 9:16 frame
                <span className={cn("w-8 h-4 rounded-full relative", addShortsFrame ? "bg-red-600" : "bg-zinc-800")}>
                  <span className={cn("absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all", addShortsFrame ? "left-4.5" : "left-0.5")} />
                </span>
              </button>

              <button
                onClick={handleRender}
                disabled={!sourceFile || isRendering}
                className="w-full bg-red-600 disabled:bg-zinc-800 disabled:text-zinc-500 hover:bg-red-700 text-white py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
              >
                {isRendering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                {isRendering ? `Rendering ${renderProgress}%` : 'Render Edited Clip'}
              </button>

              {renderedUrl && (
                <a
                  href={renderedUrl}
                  download="creator-pro-edited.mp4"
                  className="w-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Export
                </a>
              )}

              <div className="space-y-3 pt-2 border-t border-zinc-800">
                <input
                  value={uploadTitle}
                  onChange={(event) => setUploadTitle(event.target.value)}
                  placeholder="YouTube title"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
                <input
                  value={uploadTags}
                  onChange={(event) => setUploadTags(event.target.value)}
                  placeholder="#shorts, #ai"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={handleYouTubeUpload}
                  disabled={!canUploadVideo || isUploading}
                  className="w-full bg-white disabled:bg-zinc-800 disabled:text-zinc-500 hover:bg-zinc-200 text-black py-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"
                >
                  {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  {isUploading ? 'Uploading...' : 'Upload Private to YouTube'}
                </button>
                {uploadStatus && <p className="text-[10px] leading-relaxed text-zinc-400">{uploadStatus}</p>}
              </div>

              {renderError && <p className="text-[10px] leading-relaxed text-red-400">{renderError}</p>}
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Languages className="w-4 h-4 text-red-500" />
              <h3 className="text-sm font-bold text-white tracking-tight">Translation</h3>
            </div>
            <div className="px-2 py-0.5 bg-red-600/10 text-red-500 text-[8px] font-black uppercase rounded">PREMIUM</div>
          </div>

          <div className="space-y-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block mb-2">Original</span>
              <div className="flex items-center gap-3">
                <div className="w-6 h-4 bg-zinc-800 rounded-sm" />
                <span className="text-xs font-bold text-white">English (US)</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest block px-1">Target Languages</span>
              {[
                { name: 'Spanish (LATAM)', active: true },
                { name: 'Hindi', active: true },
                { name: 'Portuguese', active: false },
                { name: 'German', active: false }
              ].map((lang) => (
                <div key={lang.name} className="flex items-center justify-between p-3 bg-zinc-900/30 border border-zinc-800 rounded-xl">
                  <span className="text-xs text-zinc-300">{lang.name}</span>
                  <div className={cn(
                    "w-8 h-4 rounded-full relative transition-colors",
                    lang.active ? "bg-red-600" : "bg-zinc-800"
                  )}>
                    <div className={cn(
                      "absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all",
                      lang.active ? "left-4.5" : "left-0.5"
                    )} />
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setUploadStatus('Locale queue updated. Translation engine will use the selected languages during export.')}
              className="w-full flex items-center justify-center gap-2 py-3 border border-dashed border-zinc-800 text-zinc-500 hover:text-white hover:border-zinc-700 transition-all rounded-xl text-xs font-bold"
            >
              <Plus className="w-4 h-4" />
              Add Locale
            </button>
          </div>

          <div className="mt-auto p-4 bg-red-600/5 rounded-2xl border border-red-500/10">
            <div className="flex items-center gap-2 mb-2">
              <Settings2 className="w-4 h-4 text-red-500" />
              <span className="text-xs font-bold text-white tracking-tight">AI Settings</span>
            </div>
            <p className="text-[10px] text-zinc-500 leading-relaxed mb-4">
              Voice clone technology is active. Lip-syncing will be processed during final export.
            </p>
            <div className="flex gap-2">
              <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="h-full w-3/4 bg-red-600" />
              </div>
              <span className="text-[8px] font-mono text-zinc-400">75%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
