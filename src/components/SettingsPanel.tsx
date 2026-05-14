import React from 'react';
import { Save, Settings, Youtube } from 'lucide-react';
import { motion } from 'motion/react';
import { UserProfile } from '../types';

interface SettingsPanelProps {
  profile: UserProfile;
  setProfile: (profile: UserProfile) => void;
}

const fields: { key: keyof UserProfile; label: string; placeholder: string }[] = [
  { key: 'ownerName', label: 'Your name', placeholder: 'Masalan: Nurbek' },
  { key: 'channelName', label: 'Channel name', placeholder: 'Kanal nomini kiriting' },
  { key: 'channelUrl', label: 'YouTube channel URL', placeholder: 'https://youtube.com/@...' },
  { key: 'niche', label: 'Channel niche', placeholder: 'AI, biznes, futbol, tarix...' },
  { key: 'language', label: 'Content language', placeholder: 'Uzbek, English, Russian...' },
  { key: 'targetCountry', label: 'Target country', placeholder: 'United States, Uzbekistan...' },
  { key: 'uploadFormat', label: 'Upload format', placeholder: 'Shorts, long video, mixed' },
  { key: 'uploadsPerDay', label: 'Uploads per day', placeholder: '1, 2, 3...' },
];

export default function SettingsPanel({ profile, setProfile }: SettingsPanelProps) {
  function updateField(key: keyof UserProfile, value: string) {
    setProfile({ ...profile, [key]: value });
  }

  function clearDemoData() {
    setProfile({
      ownerName: '',
      channelName: '',
      channelUrl: '',
      niche: '',
      language: '',
      targetCountry: '',
      uploadFormat: '',
      uploadsPerDay: '',
    });
  }

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="p-8 space-y-8 max-w-[1200px] mx-auto w-full"
    >
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="bg-red-600/10 p-2 rounded-lg border border-red-500/20">
              <Settings className="w-5 h-5 text-red-500" />
            </div>
            <span className="text-xs font-bold text-red-500 uppercase tracking-widest">Your Workspace</span>
          </div>
          <h1 className="text-4xl font-display font-bold text-white tracking-tight">Settings</h1>
          <p className="text-zinc-500 mt-2 max-w-2xl">
            Bu yerda faqat sizning kanal ma’lumotlaringiz turadi. Begona akkaunt demo ma’lumotlari olib tashlandi.
          </p>
        </div>

        <button
          onClick={clearDemoData}
          className="bg-zinc-900 border border-zinc-800 text-zinc-300 px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all"
        >
          Clear fields
        </button>
      </div>

      <section className="glass-panel p-6 rounded-2xl">
        <div className="flex items-center gap-3 mb-6">
          <Youtube className="w-5 h-5 text-red-500" />
          <div>
            <h2 className="font-display font-bold text-white">Channel Profile</h2>
            <p className="text-sm text-zinc-500">Bu qiymatlar brauzeringizda saqlanadi va keyin API ulashda ishlatiladi.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {fields.map((field) => (
            <label key={field.key} className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">{field.label}</span>
              <input
                value={profile[field.key]}
                onChange={(event) => updateField(field.key, event.target.value)}
                placeholder={field.placeholder}
                className="w-full bg-zinc-950/70 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder:text-zinc-700 focus:outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/30 transition-all"
              />
            </label>
          ))}
        </div>

        <div className="mt-6 flex items-center gap-3 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3">
          <Save className="w-4 h-4" />
          Changes auto-save locally
        </div>
      </section>
    </motion.div>
  );
}
