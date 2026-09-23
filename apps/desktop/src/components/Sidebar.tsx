import React from 'react';
import {
  LayoutDashboard,
  Layers,
  ArrowDownCircle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Video,
  Music,
  FileText,
  Image as ImageIcon,
  Archive,
  Cpu,
  FolderOpen,
} from 'lucide-react';
import { useDownloadStore } from '../stores/downloadStore';
import { useUIStore } from '../stores/uiStore';
import { DownloadCategory } from '../types';

export const Sidebar: React.FC = () => {
  const { downloads, activeCategory, activeStatus, setActiveCategory, setActiveStatus } =
    useDownloadStore();
  const { currentView, setCurrentView } = useUIStore();

  const countByStatus = (status: string) =>
    downloads.filter((d) => d.status === status).length;

  const countByCategory = (category: string) => {
    if (category === 'All') return downloads.length;
    return downloads.filter((d) => {
      // Map category
      const ext = d.file_name.split('.').pop()?.toLowerCase() || '';
      if (category === 'Videos') return ['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext);
      if (category === 'Music') return ['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(ext);
      if (category === 'Documents') return ['pdf', 'doc', 'docx', 'txt', 'xls', 'xlsx'].includes(ext);
      if (category === 'Images') return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext);
      if (category === 'Archives') return ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext);
      if (category === 'Programs') return ['exe', 'msi', 'apk', 'bat'].includes(ext);
      return false;
    }).length;
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' as const },
    { id: 'all', label: 'All Downloads', icon: Layers, status: 'all', count: downloads.length },
    {
      id: 'downloading',
      label: 'Downloading',
      icon: ArrowDownCircle,
      status: 'downloading',
      count: countByStatus('downloading'),
      activeColor: 'text-primary',
    },
    {
      id: 'queued',
      label: 'Queued',
      icon: Clock,
      status: 'queued',
      count: countByStatus('queued'),
    },
    {
      id: 'completed',
      label: 'Completed',
      icon: CheckCircle2,
      status: 'completed',
      count: countByStatus('completed'),
      activeColor: 'text-emerald-500',
    },
    {
      id: 'failed',
      label: 'Failed',
      icon: AlertTriangle,
      status: 'failed',
      count: countByStatus('failed'),
      activeColor: 'text-rose-500',
    },
    { id: 'scheduled', label: 'Scheduled', icon: Calendar, view: 'scheduled' as const },
  ];

  const categories: { name: DownloadCategory; icon: any }[] = [
    { name: 'All', icon: FolderOpen },
    { name: 'Videos', icon: Video },
    { name: 'Music', icon: Music },
    { name: 'Documents', icon: FileText },
    { name: 'Images', icon: ImageIcon },
    { name: 'Archives', icon: Archive },
    { name: 'Programs', icon: Cpu },
  ];

  return (
    <aside className="w-56 bg-sidebar/80 backdrop-blur-md border-r border-sidebar-border flex flex-col justify-between p-3 select-none flex-shrink-0 text-sidebar-foreground">
      <div className="space-y-6">
        {/* Main Status Views */}
        <div>
          <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
            Overview
          </div>
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                item.view
                  ? currentView === item.view
                  : currentView === 'downloads' && activeStatus === item.status;

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    if (item.view) {
                      setCurrentView(item.view);
                    } else {
                      setCurrentView('downloads');
                      setActiveStatus(item.status!);
                    }
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold shadow-xs'
                      : 'hover:bg-sidebar-accent/50 text-muted-foreground hover:text-sidebar-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : ''}`} />
                    <span>{item.label}</span>
                  </div>
                  {item.count !== undefined && item.count > 0 && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-secondary text-secondary-foreground font-semibold">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Categories */}
        <div>
          <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
            Categories
          </div>
          <div className="space-y-0.5">
            {categories.map((cat) => {
              const Icon = cat.icon;
              const isSelected = activeCategory === cat.name;
              const count = countByCategory(cat.name);

              return (
                <button
                  key={cat.name}
                  onClick={() => {
                    setCurrentView('downloads');
                    setActiveCategory(cat.name);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                    isSelected
                      ? 'bg-primary/10 text-primary font-semibold border-l-2 border-primary'
                      : 'hover:bg-sidebar-accent/50 text-muted-foreground hover:text-sidebar-foreground'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon className="w-3.5 h-3.5" />
                    <span>{cat.name}</span>
                  </div>
                  {count > 0 && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer Info */}
      <div className="pt-3 border-t border-sidebar-border text-[11px] text-muted-foreground/70 flex items-center justify-between px-2">
        <span>v1.1.0</span>
        <span>IDM Engine</span>
      </div>
    </aside>
  );
};
