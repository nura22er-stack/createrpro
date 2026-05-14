export interface VideoPerformance {
  id: string;
  title: string;
  thumbnail: string;
  views: number;
  likes: number;
  comments: number;
  ctr: number;
  duration: string;
  publishedAt: string;
}

export interface ChannelStats {
  subscribers: number;
  subscribersGrowth: number;
  views: number;
  viewsGrowth: number;
  revenue: number;
  revenueGrowth: number;
  avgWatchTime: string;
}

export interface ChartData {
  name: string;
  views: number;
  revenue: number;
}

export type ActiveTab = 'Dashboard' | 'Admin Panel' | 'Automation' | 'Video Scraper' | 'AI Editor' | 'Analytics' | 'Earnings' | 'Settings';

export interface UserProfile {
  ownerName: string;
  channelName: string;
  channelUrl: string;
  niche: string;
  language: string;
  targetCountry: string;
  uploadFormat: string;
  uploadsPerDay: string;
}

export interface Niche {
  id: string;
  name: string;
  icon: string;
  trending: boolean;
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'ai' | 'subtitle';
  segments: { id: string; start: number; end: number; label: string; color: string }[];
}
