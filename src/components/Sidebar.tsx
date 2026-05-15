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
    <aside className="w-full md:w-64 glass-panel border-b md:border-b-0 md:border-r sticky top-0 md:h-screen flex md:flex-col z-20">
      <div className="p-4 md:p-6 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center shadow-lg shadow-red-500/20">
          <PlaySquare className="text-white w-5 h-5" />
        </div>
        <span className="font-display font-bold text-lg md:text-xl tracking-tight">CREATOR<span className="text-red-600">PRO</span></span>
      </div>

      <nav className="flex-1 px-2 md:px-4 md:space-y-1 md:mt-4 flex md:block overflow-x-auto md:overflow-visible">
        {navItems.map((item) => (
          <button
            key={item.label}
            onClick={() => setActiveTab(item.label)}
            className={cn(
              "md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl transition-all duration-200 group text-xs md:text-sm font-medium whitespace-nowrap",
              activeTab === item.label 
                ? "bg-red-600/10 text-red-500" 
                : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"
            )}
          >
            <item.icon className={cn(
              "w-4 h-4 md:w-5 md:h-5 transition-transform group-hover:scale-110",
              activeTab === item.label ? "text-red-500" : "text-zinc-500 group-hover:text-white"
            )} />
            <span className="hidden sm:inline md:inline">{item.label}</span>
            {activeTab === item.label && (
              <motion.div 
                layoutId="active-pill"
                className="hidden md:block ml-auto w-1.5 h-1.5 rounded-full bg-red-500"
              />
            )}
          </button>
        ))}
      </nav>

      <div className="p-2 md:p-4 md:border-t border-zinc-800 flex md:block gap-1 shrink-0">
        <button
          onClick={() => setActiveTab('Settings')}
          className={cn(
            "md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl text-xs md:text-sm font-medium transition-all group",
            activeTab === 'Settings'
              ? "bg-red-600/10 text-red-500"
              : "text-zinc-400 hover:bg-zinc-800/50 hover:text-white"
          )}
        >
          <Settings className={cn(
            "w-4 h-4 md:w-5 md:h-5 group-hover:rotate-45 transition-transform",
            activeTab === 'Settings' ? "text-red-500" : "text-zinc-500 group-hover:text-white"
          )} />
          <span className="hidden sm:inline md:inline">Settings</span>
        </button>
        <button
          onClick={async () => {
            await fetch('/auth/admin/logout', { method: 'POST' }).catch(() => null);
            window.location.reload();
          }}
          className="md:w-full flex items-center gap-2 md:gap-3 px-3 md:px-4 py-3 rounded-xl text-zinc-400 hover:bg-red-500/10 hover:text-red-400 text-xs md:text-sm font-medium transition-all group"
        >
          <LogOut className="w-4 h-4 md:w-5 md:h-5" />
          <span className="hidden sm:inline md:inline">Logout</span>
        </button>
      </div>
    </aside>
  );
}
