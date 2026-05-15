import React, { useState } from 'react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell
} from 'recharts';
import { BarChart3 } from 'lucide-react';

const data = [
  { name: 'Mon', views: 0, revenue: 0 },
  { name: 'Tue', views: 0, revenue: 0 },
  { name: 'Wed', views: 0, revenue: 0 },
  { name: 'Thu', views: 0, revenue: 0 },
  { name: 'Fri', views: 0, revenue: 0 },
  { name: 'Sat', views: 0, revenue: 0 },
  { name: 'Sun', views: 0, revenue: 0 },
];

export default function AnalyticsChart() {
  const [metric, setMetric] = useState<'views' | 'watch' | 'revenue'>('views');

  return (
    <div className="glass-panel p-6 rounded-2xl flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-red-500" />
            Growth Analytics
          </h2>
          <p className="text-zinc-500 text-sm">Connect your channel to load real analytics</p>
        </div>
        <div className="flex bg-zinc-800/50 p-1 rounded-lg border border-zinc-700/50">
          {[
            { id: 'views', label: 'Views' },
            { id: 'watch', label: 'Watch Time' },
            { id: 'revenue', label: 'Revenue' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setMetric(item.id as typeof metric)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                metric === item.id ? 'text-white bg-red-600 shadow-lg shadow-red-500/20' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ff0000" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#ff0000" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#27272a opacity-20" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#71717a', fontSize: 12 }}
              dy={10}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{ fill: '#71717a', fontSize: 12 }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#18181b', 
                border: '1px solid #27272a',
                borderRadius: '12px',
                color: '#fff'
              }}
              itemStyle={{ color: '#fff' }}
              cursor={{ stroke: '#3f3f46', strokeWidth: 1 }}
            />
            <Area 
              type="monotone" 
              dataKey="views" 
              stroke="#ff0000" 
              strokeWidth={3}
              fillOpacity={1} 
              fill="url(#colorViews)" 
              animationDuration={1500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
