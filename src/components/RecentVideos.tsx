import React from 'react';
import { motion } from 'motion/react';
import { UploadCloud } from 'lucide-react';

export default function RecentVideos() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-white">Recent Content</h2>
          <p className="text-zinc-500 text-sm">Performance of your last 24h uploads</p>
        </div>
        <button className="text-xs font-semibold text-zinc-400 hover:text-white transition-colors border border-zinc-700/50 px-4 py-2 rounded-lg hover:bg-zinc-800">
          View All
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="glass-panel rounded-2xl border-dashed p-10 min-h-64 flex flex-col items-center justify-center text-center"
      >
        <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
          <UploadCloud className="w-6 h-6 text-red-500" />
        </div>
        <h3 className="font-display font-bold text-white">No channel videos connected yet</h3>
        <p className="text-sm text-zinc-500 max-w-md mt-2">
          YouTube akkauntingiz OAuth orqali ulangandan keyin real videolar, view, like va comment statistikasi shu yerda chiqadi.
        </p>
      </motion.div>
    </div>
  );
}
