import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Eye, Heart, MessageCircle, PlayCircle, RefreshCcw, UploadCloud } from 'lucide-react';

interface RecentVideosProps {
  onOpenEditor: () => void;
}

interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  views: number;
  likes: number;
  comments: number;
  duration: string;
  publishedAt: string;
  privacyStatus: string;
  url: string;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default function RecentVideos({ onOpenEditor }: RecentVideosProps) {
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadVideos() {
    try {
      setLoading(true);
      setError('');
      const response = await fetch('/api/youtube/videos');
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Videos could not be loaded.');
      }

      setVideos(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Videos could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadVideos();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-white">Recent Content</h2>
          <p className="text-zinc-500 text-sm">Latest videos from your connected YouTube channel</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadVideos}
            className="text-xs font-semibold text-zinc-400 hover:text-white transition-colors border border-zinc-700/50 px-3 py-2 rounded-lg hover:bg-zinc-800 flex items-center gap-2"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={onOpenEditor}
            className="text-xs font-semibold text-zinc-400 hover:text-white transition-colors border border-zinc-700/50 px-4 py-2 rounded-lg hover:bg-zinc-800"
          >
            Editor
          </button>
        </div>
      </div>

      {videos.length ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {videos.map((video, index) => (
            <motion.a
              key={video.id}
              href={video.url}
              target="_blank"
              rel="noreferrer"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="glass-panel rounded-2xl overflow-hidden hover:border-red-500/40 transition-all group"
            >
              <div className="aspect-video bg-zinc-900 relative overflow-hidden">
                {video.thumbnail ? (
                  <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <UploadCloud className="w-8 h-8 text-zinc-600" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <PlayCircle className="w-11 h-11 text-white" />
                </div>
                <span className="absolute top-2 left-2 bg-black/70 text-white text-[10px] font-bold uppercase px-2 py-1 rounded-full">
                  {video.privacyStatus}
                </span>
              </div>
              <div className="p-4">
                <h3 className="text-sm font-semibold text-white line-clamp-2 min-h-10">{video.title}</h3>
                <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" />{compactNumber(video.views)}</span>
                  <span className="flex items-center gap-1"><Heart className="w-3.5 h-3.5" />{compactNumber(video.likes)}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="w-3.5 h-3.5" />{compactNumber(video.comments)}</span>
                </div>
              </div>
            </motion.a>
          ))}
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-panel rounded-2xl border-dashed p-10 min-h-64 flex flex-col items-center justify-center text-center"
        >
          <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
            <UploadCloud className="w-6 h-6 text-red-500" />
          </div>
          <h3 className="font-display font-bold text-white">{loading ? 'Loading channel videos...' : 'No channel videos found yet'}</h3>
          <p className="text-sm text-zinc-500 max-w-md mt-2">
            {error || 'AI agent video yuklagandan keyin bu yerda real YouTube video kartalari chiqadi.'}
          </p>
        </motion.div>
      )}
    </div>
  );
}
