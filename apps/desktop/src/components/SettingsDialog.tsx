import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  HardDrive,
  Cpu,
  Bell,
  Globe,
  Film,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Copy,
  Check,
} from 'lucide-react';
import { useUIStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
import { AppSettings } from '../types';

export const SettingsDialog: React.FC = () => {
  const { isSettingsOpen, closeSettings } = useUIStore();
  const { settings, ffmpegInfo, updateSettings, detectFFmpeg } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<'general' | 'downloads' | 'browser' | 'ffmpeg'>('general');
  const [formData, setFormData] = useState<AppSettings | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  useEffect(() => {
    if (isSettingsOpen) {
      if (settings) {
        setFormData({ ...settings });
      }
      detectFFmpeg();
    }
  }, [isSettingsOpen, settings]);

  const handleChange = (key: keyof AppSettings, value: any) => {
    if (!formData) return;
    setFormData({
      ...formData,
      [key]: value,
    });
  };

  const handleSave = async () => {
    if (!formData) return;
    await updateSettings(formData);
    closeSettings();
  };

  const copyToken = () => {
    if (formData?.browser_bridge_token) {
      navigator.clipboard.writeText(formData.browser_bridge_token);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  if (!isSettingsOpen || !formData) return null;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 select-none">
      <div className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center justify-between bg-card/90">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-sm text-foreground">NovaDownload Settings</h3>
          </div>
          <button
            onClick={closeSettings}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings Body with Side Tabs */}
        <div className="flex flex-1 overflow-hidden">
          {/* Tabs Sidebar */}
          <div className="w-44 bg-secondary/30 border-r border-border p-3 space-y-1 text-xs">
            <button
              onClick={() => setActiveTab('general')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition cursor-pointer ${
                activeTab === 'general'
                  ? 'bg-primary/15 text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>General</span>
            </button>

            <button
              onClick={() => setActiveTab('downloads')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition cursor-pointer ${
                activeTab === 'downloads'
                  ? 'bg-primary/15 text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Engine & Speed</span>
            </button>

            <button
              onClick={() => setActiveTab('browser')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition cursor-pointer ${
                activeTab === 'browser'
                  ? 'bg-primary/15 text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>Browser Bridge</span>
            </button>

            <button
              onClick={() => setActiveTab('ffmpeg')}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md font-medium transition cursor-pointer ${
                activeTab === 'ffmpeg'
                  ? 'bg-primary/15 text-primary font-semibold'
                  : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>FFmpeg Service</span>
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 p-6 overflow-y-auto text-xs space-y-5">
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="font-semibold text-foreground">Default Download Folder</label>
                  <input
                    type="text"
                    value={formData.default_download_directory}
                    onChange={(e) => handleChange('default_download_directory', e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary focus:bg-background outline-none transition font-mono text-xs text-foreground"
                  />
                </div>

                <div className="pt-2 border-t border-border/50 space-y-3">
                  <div className="font-semibold text-foreground">System Integration</div>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.clipboard_monitor_enabled}
                      onChange={(e) => handleChange('clipboard_monitor_enabled', e.target.checked)}
                      className="rounded text-primary focus:ring-primary h-4 w-4"
                    />
                    <span className="text-foreground font-medium">Enable Clipboard URL Monitor</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.notifications_enabled}
                      onChange={(e) => handleChange('notifications_enabled', e.target.checked)}
                      className="rounded text-primary focus:ring-primary h-4 w-4"
                    />
                    <span className="text-foreground font-medium">Show Desktop Notifications</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.close_to_tray}
                      onChange={(e) => handleChange('close_to_tray', e.target.checked)}
                      className="rounded text-primary focus:ring-primary h-4 w-4"
                    />
                    <span className="text-foreground font-medium">Minimize to System Tray on Close</span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === 'downloads' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Default Threads / Connections</label>
                    <select
                      value={formData.default_connections}
                      onChange={(e) => handleChange('default_connections', parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition cursor-pointer"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={4}>4 (Default)</option>
                      <option value={8}>8</option>
                      <option value={16}>16</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-foreground">Max Concurrent Downloads</label>
                    <select
                      value={formData.max_concurrent_downloads}
                      onChange={(e) => handleChange('max_concurrent_downloads', parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition cursor-pointer"
                    >
                      <option value={1}>1</option>
                      <option value={2}>2</option>
                      <option value={3}>3 (Default)</option>
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-foreground">Global Speed Limit</label>
                  <select
                    value={formData.global_speed_limit}
                    onChange={(e) => handleChange('global_speed_limit', parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition cursor-pointer"
                  >
                    <option value={0}>Unlimited</option>
                    <option value={1048576}>1 MB/s (1024 KB/s)</option>
                    <option value={5242880}>5 MB/s</option>
                    <option value={10485760}>10 MB/s</option>
                    <option value={20971520}>20 MB/s</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-foreground">Duplicate File Handling</label>
                  <select
                    value={formData.duplicate_action}
                    onChange={(e) => handleChange('duplicate_action', e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition cursor-pointer"
                  >
                    <option value="rename">Auto Rename: filename (1).ext</option>
                    <option value="overwrite">Overwrite existing file</option>
                    <option value="skip">Skip / Ignore</option>
                  </select>
                </div>
              </div>
            )}

            {activeTab === 'browser' && (
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-secondary/40 border border-border space-y-1">
                  <div className="font-semibold text-foreground flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span>Local Bridge Active</span>
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    The Chrome/Firefox browser extension communicates with NovaDownload locally via this port.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-foreground">Bridge Port</label>
                  <input
                    type="number"
                    value={formData.browser_bridge_port}
                    onChange={(e) => handleChange('browser_bridge_port', parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition font-mono text-xs text-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-foreground">Security Token</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={formData.browser_bridge_token}
                      className="flex-1 px-3 py-2 rounded-md bg-secondary/40 border border-border font-mono text-xs text-muted-foreground outline-none"
                    />
                    <button
                      type="button"
                      onClick={copyToken}
                      className="px-3 py-2 rounded-md bg-secondary hover:bg-secondary/80 font-medium text-foreground transition flex items-center gap-1 cursor-pointer"
                    >
                      {copiedToken ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedToken ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'ffmpeg' && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-secondary/40 border border-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">FFmpeg Binary Status</span>
                    {ffmpegInfo?.is_available ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/20">
                        Available & Ready
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-500 border border-amber-500/20">
                        Not Found
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground text-[11px] font-mono">
                    {ffmpegInfo?.version || 'FFmpeg was not detected automatically on PATH.'}
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-foreground">Custom FFmpeg Path (Optional)</label>
                  <input
                    type="text"
                    placeholder="C:\ffmpeg\bin\ffmpeg.exe"
                    value={formData.ffmpeg_path || ''}
                    onChange={(e) => handleChange('ffmpeg_path', e.target.value)}
                    className="w-full px-3 py-2 rounded-md bg-secondary/60 border border-border focus:border-primary outline-none transition font-mono text-xs text-foreground"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border flex items-center justify-end gap-2 bg-card/90">
          <button
            type="button"
            onClick={closeSettings}
            className="px-3 py-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground text-xs font-medium transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-md shadow-primary/30 transition active:scale-95 cursor-pointer"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
};
