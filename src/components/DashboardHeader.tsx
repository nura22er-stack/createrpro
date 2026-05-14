import React from 'react';
import { Search, Bell, User, Plus, SearchIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { UserProfile } from '../types';

interface DashboardHeaderProps {
  profile: UserProfile;
}

export default function DashboardHeader({ profile }: DashboardHeaderProps) {
  const displayName = profile.ownerName || 'Your name';
  const role = profile.channelName || 'Your channel';

  return (
    <header className="h-20 border-b border-zinc-800/50 sticky top-0 bg-zinc-950/80 backdrop-blur-md z-10 px-8 flex items-center justify-between">
      <div className="flex-1 max-w-xl">
        <div className="relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 group-focus-within:text-red-500 transition-colors" />
          <input 
            type="text" 
            placeholder="Search analytics, videos, or tools..." 
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl py-2.5 pl-11 pr-4 text-sm text-zinc-300 focus:outline-none focus:ring-1 focus:ring-red-500/50 focus:border-red-500/50 transition-all"
          />
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button className="p-2.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2.5 right-2.5 w-2 h-2 bg-red-600 rounded-full border-2 border-zinc-950" />
        </button>
        
        <div className="h-8 w-px bg-zinc-800 mx-2" />
        
        <motion.button 
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-red-600/20 transition-all"
        >
          <Plus className="w-4 h-4" />
          Create
        </motion.button>

        <button className="flex items-center gap-3 pl-2 pr-1 py-1 rounded-full hover:bg-zinc-800 transition-all border border-transparent hover:border-zinc-700/50">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold text-white tracking-tight leading-none mb-0.5">{displayName}</p>
            <p className="text-[10px] text-zinc-500 font-mono leading-none uppercase">{role}</p>
          </div>
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-red-600 to-amber-500 p-0.5">
            <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center overflow-hidden">
              <User className="w-5 h-5 text-zinc-400" />
            </div>
          </div>
        </button>
      </div>
    </header>
  );
}
