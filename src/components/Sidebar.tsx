import React from 'react';
import { 
  LayoutDashboard, 
  Zap, 
  Search, 
  Video, 
  DollarSign, 
  Settings, 
  BarChart3,
  LogOut,
  PlaySquare,
  ShieldCheck
} from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';

import { ActiveTab } from '../types';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

const navItems: { icon: any, label: ActiveTab }[] = [
  { icon: LayoutDashboard, label: 'Dashboard' },
  { icon: ShieldCheck, label: 'Admin Panel' },
  { icon: Zap, label: 'Automation' },
  { icon: Search, label: 'Video Scraper' },
  { icon: Video, label: 'AI Editor' },
  { icon: BarChart3, label: 'Analytics' },
  { icon: DollarSign, label: 'Earnings' },
];

export default function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <aside className="w-64 glass-panel border-r sticky top-0 h-screen flex flex-col z-20">
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center shadow-lg shadow-red-500/20">
          <PlaySquare className="text-white w-5 h-5" />
        </div>
        <span className="font-display font-bold text-xl tracking-tight">CREATOR<span className="text-red-600">PRO</span></span>
      </div>

      <nav className="flex-1 px-4 space-y-1 mt-4">
        {navItems.map((item) => (
          <button
            key={item.label}
            onClick={() => setActiveTab(item.label)}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group text-sm font-medium",
              activeTab === item.label 
                ? "bg-red-600/10 text-red-500" 
                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"
            )}
          >
            <item.icon className={cn(
              "w-5 h-5 transition-transform group-hover:scale-110",
              activeTab === item.label ? "text-red-500" : "text-zinc-500 group-hover:text-white"
            )} />
            {item.label}
            {activeTab === item.label && (
              <motion.div 
                layoutId="active-pill"
                className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500"
              />
            )}
          </button>
        ))}
      </nav>

      <div className="p-4 border-t border-zinc-800">
        <button
          onClick={() => setActiveTab('Settings')}
          className={cn(
            "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all group",
            activeTab === 'Settings'
              ? "bg-red-600/10 text-red-500"
              : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"
          )}
        >
          <Settings className={cn(
            "w-5 h-5 group-hover:rotate-45 transition-transform",
            activeTab === 'Settings' ? "text-red-500" : "text-zinc-500 group-hover:text-white"
          )} />
          Settings
        </button>
        <button
          onClick={async () => {
            await fetch('/auth/youtube/disconnect', { method: 'POST' }).catch(() => null);
            window.location.reload();
          }}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-zinc-400 hover:bg-red-500/10 hover:text-red-400 text-sm font-medium transition-all group"
        >
          <LogOut className="w-5 h-5" />
          Logout
        </button>
      </div>
    </aside>
  );
}
