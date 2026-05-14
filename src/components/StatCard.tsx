import React from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, ArrowDownRight, LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface StatCardProps {
  label: string;
  value: string;
  growth: number;
  icon: LucideIcon;
  delay?: number;
}

export default function StatCard({ label, value, growth, icon: Icon, delay = 0 }: StatCardProps) {
  const isPositive = growth >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-panel p-6 rounded-2xl relative overflow-hidden group hover:border-zinc-500/50 transition-colors"
    >
      <div className="absolute top-0 left-0 w-1 h-full bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity" />
      
      <div className="flex justify-between items-start mb-4">
        <div className="p-2.5 bg-zinc-800/50 rounded-xl border border-zinc-700/50 group-hover:border-red-500/30 transition-colors">
          <Icon className="w-5 h-5 text-zinc-400 group-hover:text-red-500 transition-colors" />
        </div>
        <div className={cn(
          "flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full",
          isPositive ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
        )}>
          {isPositive ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
          {Math.abs(growth)}%
        </div>
      </div>

      <div>
        <h3 className="text-zinc-500 text-sm font-medium tracking-tight mb-1">{label}</h3>
        <p className="text-2xl font-display font-bold tracking-tight text-white">{value}</p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: '70%' }}
            transition={{ duration: 1, delay: delay + 0.5 }}
            className="h-full bg-gradient-to-r from-red-600 to-red-400"
          />
        </div>
        <span className="text-[10px] text-zinc-600 font-mono">GOAL 70%</span>
      </div>
    </motion.div>
  );
}
