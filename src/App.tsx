import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import DashboardHeader from './components/DashboardHeader';
import StatCard from './components/StatCard';
import AnalyticsChart from './components/AnalyticsChart';
import RecentVideos from './components/RecentVideos';
import AIEditor from './components/AIEditor';
import AdminPanel from './components/AdminPanel';
import SettingsPanel from './components/SettingsPanel';
import { 
  Users, 
  Eye, 
  Clock, 
  DollarSign,
  TrendingUp,
  Award
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ActiveTab } from './types';
import { UserProfile } from './types';

interface SessionState {
  authenticated: boolean;
  email: string;
  adminEmail: string;
  loginUrl: string;
}

interface YouTubeSummary {
  channelTitle: string;
  subscribers: number;
  subscribersHidden: boolean;
  totalViews: number;
  totalVideos: number;
  recentViews: number;
  recentLikes: number;
  recentComments: number;
  latestVideoCount: number;
  estimatedRevenue: number | null;
  avgWatchTime: string | null;
  chart: { name: string; views: number; revenue: number }[];
  updatedAt: string;
}

interface NotificationItem {
  id: string;
  at: string;
  type: string;
  title: string;
  message: string;
  read: boolean;
}

const emptyProfile: UserProfile = {
  ownerName: '',
  channelName: '',
  channelUrl: '',
  niche: '',
  language: '',
  targetCountry: '',
  uploadFormat: '',
  uploadsPerDay: '',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('Dashboard');
  const [session, setSession] = useState<SessionState | null>(null);
  const [summary, setSummary] = useState<YouTubeSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [profile, setProfileState] = useState<UserProfile>(() => {
    try {
      const stored = localStorage.getItem('creator-pro-profile');
      return stored ? { ...emptyProfile, ...JSON.parse(stored) } : emptyProfile;
    } catch {
      return emptyProfile;
    }
  });
  const [profileSaveStatus, setProfileSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');

  function formatNumber(value: number) {
    return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  function setProfile(nextProfile: UserProfile) {
    if (!session?.authenticated) return;
    setProfileState(nextProfile);
    localStorage.setItem('creator-pro-profile', JSON.stringify(nextProfile));
    setProfileSaveStatus('saving');

    fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nextProfile),
    })
      .then((response) => {
        if (!response.ok) throw new Error('Profile save failed');
        setProfileSaveStatus('saved');
      })
      .catch(() => setProfileSaveStatus('offline'));
  }

  useEffect(() => {
    fetch('/api/session')
      .then((response) => response.json())
      .then(setSession)
      .catch(() => setSession({ authenticated: false, email: '', adminEmail: 'm6dhhjffu@gmail.com', loginUrl: '/auth/admin' }));
  }, []);

  useEffect(() => {
    if (!session?.authenticated) return;

    fetch('/api/profile')
      .then((response) => {
        if (!response.ok) throw new Error('Profile load failed');
        return response.json();
      })
      .then((serverProfile) => {
        const nextProfile = { ...emptyProfile, ...serverProfile };
        setProfileState(nextProfile);
        localStorage.setItem('creator-pro-profile', JSON.stringify(nextProfile));
        setProfileSaveStatus('saved');
      })
      .catch(() => setProfileSaveStatus('offline'));
  }, [session?.authenticated]);

  useEffect(() => {
    if (!session?.authenticated) return;

    const loadNotifications = () => {
      fetch('/api/notifications')
        .then((response) => {
          if (!response.ok) throw new Error('Notifications unavailable');
          return response.json();
        })
        .then((data) => {
          setNotifications(data.notifications || []);
          setUnreadCount(Number(data.unreadCount || 0));
        })
        .catch(() => null);
    };

    const loadSummary = () => {
      fetch('/api/youtube/summary')
        .then((response) => {
          if (!response.ok) throw new Error('YouTube statistics not available');
          return response.json();
        })
        .then((data) => {
          setSummary(data);
          setSummaryError('');
        })
        .catch((error) => setSummaryError(error instanceof Error ? error.message : 'YouTube statistics not available'));
      loadNotifications();
    };

    loadSummary();
    const interval = window.setInterval(loadSummary, 60000);
    return () => window.clearInterval(interval);
  }, [session?.authenticated]);

  async function readNotifications() {
    setUnreadCount(0);
    await fetch('/api/notifications/read', { method: 'POST' }).catch(() => null);
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
  }

  useEffect(() => {
    if (sessionStorage.getItem('creator-pro-welcome-spoken')) return;

    let audioUrl = '';

    const playGeminiWelcome = async () => {
      const response = await fetch('/api/voice/welcome');
      if (!response.ok) return;
      const blob = await response.blob();
      audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);

      const play = async () => {
        try {
          await audio.play();
          sessionStorage.setItem('creator-pro-welcome-spoken', 'true');
        } catch {
          window.addEventListener('pointerdown', play, { once: true });
        }
      };

      await play();
    };

    const timer = window.setTimeout(() => {
      void playGeminiWelcome();
    }, 700);

    return () => {
      window.clearTimeout(timer);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, []);

  if (!session) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="glass-panel rounded-2xl p-6 w-full max-w-sm text-center">
          <p className="text-sm text-zinc-400">Creator Pro yuklanmoqda...</p>
        </div>
      </div>
    );
  }

  if (!session.authenticated) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 selection:bg-red-500/30">
        <div className="glass-panel rounded-2xl p-6 sm:p-8 w-full max-w-md">
          <div className="w-12 h-12 bg-red-600 rounded-xl flex items-center justify-center shadow-lg shadow-red-500/20 mb-5">
            <Award className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">Creator Pro Admin</h1>
          <p className="text-sm text-zinc-400 mt-3 leading-relaxed">
            Bu dashboard shaxsiy. Account, YouTube statistika va admin panel faqat {session.adminEmail} orqali ochiladi.
          </p>
          <a
            href={session.loginUrl}
            className="mt-6 w-full bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-xl text-sm font-bold flex items-center justify-center transition-all"
          >
            Google bilan kirish
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-zinc-950 text-zinc-100 selection:bg-red-500/30">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 flex flex-col min-w-0 h-[calc(100vh-76px)] md:h-screen overflow-hidden">
        {activeTab !== 'AI Editor' && (
          <DashboardHeader
            profile={profile}
            onCreate={() => setActiveTab('AI Editor')}
            onOpenSettings={() => setActiveTab('Settings')}
            notifications={notifications}
            unreadCount={unreadCount}
            onReadNotifications={readNotifications}
          />
        )}
        
        <div className="flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'Dashboard' ? (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 sm:p-6 lg:p-8 space-y-8 lg:space-y-10 max-w-[1600px] mx-auto w-full"
              >
                {/* Welcome Area */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div>
                    <motion.div 
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-3 mb-2"
                    >
                      <div className="bg-red-600/10 p-2 rounded-lg">
                        <Award className="w-5 h-5 text-red-500" />
                      </div>
                      <span className="text-xs font-bold text-red-500 uppercase tracking-widest">Creator Profile</span>
                    </motion.div>
                    <h1 className="text-3xl sm:text-4xl font-display font-bold text-white tracking-tight">
                      {summary?.channelTitle || profile.channelName || 'Your Channel Overview'}
                    </h1>
                    <p className="text-zinc-500 mt-1">
                      {summary ? `Updated: ${new Date(summary.updatedAt).toLocaleTimeString()}` : summaryError || 'Open Admin Panel and connect YouTube to load real stats.'}
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3 bg-zinc-900/50 p-1.5 rounded-2xl border border-zinc-800">
                    {['24h', '7d', '28d', '90d'].map((period) => (
                      <button 
                        key={period}
                        className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                          period === '28d' ? 'bg-zinc-800 text-white border border-zinc-700' : 'text-zinc-500 hover:text-white'
                        }`}
                      >
                        {period}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                  <StatCard 
                    label="Total Subscribers" 
                    value={summary?.subscribersHidden ? 'Hidden' : formatNumber(summary?.subscribers || 0)}
                    growth={0} 
                    icon={Users} 
                    delay={0.1}
                  />
                  <StatCard 
                    label="Total Views" 
                    value={formatNumber(summary?.totalViews || 0)}
                    growth={0} 
                    icon={Eye} 
                    delay={0.2}
                  />
                  <StatCard 
                    label="Recent Likes" 
                    value={formatNumber(summary?.recentLikes || 0)}
                    growth={0} 
                    icon={Clock} 
                    delay={0.3}
                  />
                  <StatCard 
                    label="Videos" 
                    value={formatNumber(summary?.totalVideos || 0)}
                    growth={0} 
                    icon={DollarSign} 
                    delay={0.4}
                  />
                </div>

                {/* Main Content Sections */}
                <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
                  <div className="xl:col-span-2 space-y-8">
                    <AnalyticsChart
                      data={summary?.chart}
                      subtitle={summary ? `Last 7 days from ${summary.latestVideoCount} recent uploads` : summaryError || 'Connect YouTube to load real analytics'}
                    />
                    <RecentVideos onOpenEditor={() => setActiveTab('AI Editor')} />
                  </div>

                  <div className="space-y-8">
                    {/* Secondary Stats/Tools */}
                    <div className="glass-panel p-6 rounded-2xl space-y-6">
                      <div className="flex items-center justify-between">
                        <h3 className="font-display font-bold text-white">Top Geographies</h3>
                        <button
                          onClick={() => setActiveTab('Analytics')}
                          className="text-xs text-zinc-500 hover:text-white transition-colors"
                        >
                          Details
                        </button>
                      </div>
                      <div className="space-y-4">
                        {[
                          { country: profile.targetCountry || 'Target country', percentage: 0, color: '#ef4444' },
                          { country: 'Secondary market', percentage: 0, color: '#f59e0b' },
                          { country: 'Discovery pending', percentage: 0, color: '#3b82f6' },
                          { country: 'OAuth data needed', percentage: 0, color: '#10b981' },
                        ].map((item) => (
                          <div key={item.country} className="space-y-1.5">
                            <div className="flex justify-between text-xs font-medium">
                              <span className="text-zinc-300">{item.country}</span>
                              <span className="text-white">{item.percentage}%</span>
                            </div>
                            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${item.percentage}%` }}
                                transition={{ duration: 1, delay: 0.5 }}
                                style={{ backgroundColor: item.color }}
                                className="h-full rounded-full"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="glass-panel p-6 rounded-2xl bg-gradient-to-br from-red-600/20 to-transparent border-red-500/20">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="bg-red-600 p-2 rounded-lg">
                          <TrendingUp className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h3 className="font-display font-bold text-white leading-tight">Growth Insight</h3>
                          <p className="text-[10px] text-zinc-400 font-mono uppercase tracking-widest">AI analysis</p>
                        </div>
                      </div>
                      <p className="text-sm text-zinc-300 leading-relaxed mb-4">
                        Connect your YouTube channel to scan real performance, monetization readiness, upload errors and growth opportunities.
                      </p>
                      <button
                        onClick={() => setActiveTab('Admin Panel')}
                        className="w-full bg-white text-black py-2.5 rounded-xl font-bold text-xs hover:bg-zinc-200 transition-all"
                      >
                        Optimize Channel
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : activeTab === 'Admin Panel' ? (
              <AdminPanel />
            ) : activeTab === 'Settings' ? (
              <SettingsPanel profile={profile} setProfile={setProfile} saveStatus={profileSaveStatus} />
            ) : activeTab === 'AI Editor' ? (
              <motion.div 
                key="editor"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-full"
              >
                <AIEditor />
              </motion.div>
            ) : (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <h2 className="text-2xl font-display font-bold text-white mb-2">{activeTab}</h2>
                  <p className="text-zinc-500">Feature coming soon...</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
