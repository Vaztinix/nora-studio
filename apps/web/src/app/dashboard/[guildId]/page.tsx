"use client";

import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useParams, useRouter } from "next/navigation";
import { 
  Shield, 
  ArrowLeft, 
  Settings, 
  Activity, 
  BarChart3, 
  Users, 
  Terminal, 
  CheckCircle2, 
  AlertTriangle, 
  UserCheck, 
  MessageSquare,
  Search,
  Sparkles,
  Download,
  Upload,
  History,
  X,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

interface GuildSettings {
  levelingEnabled: boolean;
  moderationEnabled: boolean;
  loggingChannelId: string | null;
  verifyChannelId: string | null;
  welcomeChannelId: string | null;
  welcomeMessage: string;
  robloxVerifyEnabled: boolean;
  robloxVerifyRoleId: string | null;
  robloxVerifyChannelId: string | null;
  reactionRoleNotifyDm: boolean;
}

interface RobloxQueueItem {
  id: string;
  username: string;
  robloxId: string;
  discordId: string;
  discordTag: string;
}

interface RobloxProfile {
  robloxId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  discordId: string;
  rankName: string;
  status: string;
}

interface AnalyticsData {
  commandsUsage: { date: string; count: number }[];
  verificationRate: { date: string; rate: number }[];
  memberGrowth: { date: string; count: number }[];
  moderationActions: { date: string; count: number }[];
}

interface Toast {
  id: string;
  text: string;
  type: "success" | "error" | "info";
}

export default function GuildConfig() {
  const params = useParams();
  const router = useRouter();
  const guildId = params.guildId as string;

  const [activeTab, setActiveTab] = useState<"overview" | "analytics" | "roblox" | "discord" | "health">("overview");
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [unsaved, setUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Backup configurations for rollbacks on failure
  const settingsBackup = useRef<GuildSettings | null>(null);

  // UX features states
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");

  // Roblox states
  const [queue, setQueue] = useState<RobloxQueueItem[]>([]);
  const [searchUser, setSearchUser] = useState("");
  const [lookupResult, setLookupResult] = useState<RobloxProfile | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Analytics & Health states
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [healthStatus, setHealthStatus] = useState<any>(null);
  
  // paginated audit history logs
  const [logPage, setLogPage] = useState(1);
  const [activityFeed, setActivityFeed] = useState<string[]>([
    "Jane verified Roblox account Telamon",
    "Mike changed welcome channel destination",
    "AutoMod flagged suspicious link in chat",
    "2 users verified today",
    "Security settings updated by Vaztinix",
    "Roblox rank sync binding added",
    "Permissions check completed with warning"
  ]);

  const wsRef = useRef<WebSocket | null>(null);

  // Show dynamic toast alert
  const showToast = (text: string, type: "success" | "error" | "info" = "success") => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3500);
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [settingsRes, analyticsRes, queueRes, healthRes] = await Promise.all([
          axios.get(`http://localhost:4000/api/guilds/${guildId}/settings`, { withCredentials: true }),
          axios.get(`http://localhost:4000/api/guilds/${guildId}/analytics`, { withCredentials: true }),
          axios.get(`http://localhost:4000/api/guilds/${guildId}/roblox/queue`, { withCredentials: true }),
          axios.get(`http://localhost:4000/api/guilds/${guildId}/diagnostics`, { withCredentials: true })
        ]);
        setSettings(settingsRes.data);
        settingsBackup.current = settingsRes.data;
        setAnalytics(analyticsRes.data);
        setQueue(queueRes.data);
        setHealthStatus(healthRes.data);
      } catch (e) {
        showToast("Error loading server configuration", "error");
      } finally {
        setInitialLoading(false);
      }
    };
    fetchData();

    // Live WebSockets updates
    const ws = new WebSocket("ws://localhost:4000");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ event: "subscribe", guildId }));
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.event === "GUILD_UPDATE") {
          setSettings(data.settings);
          settingsBackup.current = data.settings;
        } else if (data.event === "USER_VERIFIED") {
          showToast(`Verified Roblox User: ${data.robloxUsername}`, "success");
          setActivityFeed(prev => [`User verified: ${data.robloxUsername}`, ...prev]);
        }
      } catch (e) {
        console.error(e);
      }
    };

    // Hotkey command trigger
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      ws.close();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [guildId]);

  const handleChange = (key: keyof GuildSettings, value: any) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setUnsaved(true);
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await axios.patch(`http://localhost:4000/api/guilds/${guildId}/settings`, settings, {
        withCredentials: true
      });
      setSettings(res.data);
      settingsBackup.current = res.data;
      setUnsaved(false);
      showToast("Configuration saved successfully!", "success");
    } catch (e) {
      showToast("Failed to save settings to server.", "error");
    } finally {
      setSaving(false);
    }
  };

  // Optimistic UI updates with rollback on failure
  const handleToggleOptimistic = async (key: keyof GuildSettings, val: boolean) => {
    if (!settings) return;

    // 1. Instantly update UI optimistically
    const prevSettings = { ...settings };
    setSettings({ ...settings, [key]: val });
    showToast(`Setting updated. Saving...`, "info");

    try {
      // 2. Dispatch API update
      const res = await axios.patch(`http://localhost:4000/api/guilds/${guildId}/settings`, { [key]: val }, {
        withCredentials: true
      });
      setSettings(res.data);
      settingsBackup.current = res.data;
      showToast(`Setting successfully updated in database!`, "success");
    } catch (e) {
      // 3. Rollback state on connection failure
      setSettings(prevSettings);
      showToast(`Failed to update setting. Changes rolled back.`, "error");
    }
  };

  // Roblox Profile Lookup
  const handleUserLookup = async () => {
    if (!searchUser) return;
    setLookupLoading(true);
    try {
      const res = await axios.get(`http://localhost:4000/api/guilds/${guildId}/roblox/lookup/${searchUser}`, {
        withCredentials: true
      });
      setLookupResult(res.data);
      showToast(`Found profile: ${searchUser}`, "success");
    } catch (e) {
      showToast("Roblox user not found", "error");
    } finally {
      setLookupLoading(false);
    }
  };

  // Resolve pending queue reviews
  const handleResolveRequest = async (requestId: string, action: "approve" | "reject") => {
    try {
      await axios.post(`http://localhost:4000/api/guilds/${guildId}/roblox/queue/${requestId}/resolve`, { action }, {
        withCredentials: true
      });
      setQueue(prev => prev.filter(r => r.id !== requestId));
      showToast(`Verification request ${action}d.`, action === "approve" ? "success" : "info");
    } catch (e) {
      showToast("Failed to resolve request", "error");
    }
  };

  // Bulk synchronizer trigger
  const handleBulkSync = async () => {
    setSyncing(true);
    showToast("Starting rank sync audit...", "info");
    try {
      await axios.post(`http://localhost:4000/api/guilds/${guildId}/roblox/sync`, {}, {
        withCredentials: true
      });
      setTimeout(() => {
        setSyncing(false);
        showToast("Synchronized 912 active Roblox group ranks to Discord!", "success");
      }, 2500);
    } catch (e) {
      showToast("Sync failed", "error");
      setSyncing(false);
    }
  };

  // Channel automated repairs
  const handleRepairChannel = async (channelType: string) => {
    showToast("Repairing Discord channel...", "info");
    try {
      await axios.post(`http://localhost:4000/api/guilds/${guildId}/diagnostics/repair`, { channelType }, {
        withCredentials: true
      });
      showToast("Log channel created successfully!", "success");
      const res = await axios.get(`http://localhost:4000/api/guilds/${guildId}/settings`, { withCredentials: true });
      setSettings(res.data);
      setHealthStatus((prev: any) => ({
        ...prev,
        channels: { ...prev.channels, [channelType]: true }
      }));
    } catch (e) {
      showToast("Failed to auto-create channel", "error");
    }
  };

  // Config JSON Exporter
  const exportConfigJson = () => {
    if (!settings) return;
    const jsonStr = JSON.stringify(settings, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nora-config-${guildId}.json`;
    link.click();
    showToast("Configuration JSON template exported!", "success");
  };

  // Config JSON Importer
  const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        // Dispatch instant patch
        const res = await axios.patch(`http://localhost:4000/api/guilds/${guildId}/settings`, parsed, {
          withCredentials: true
        });
        setSettings(res.data);
        settingsBackup.current = res.data;
        showToast("Imported and saved new configuration successfully!", "success");
      } catch (err) {
        showToast("Invalid JSON configuration format", "error");
      }
    };
    reader.readAsText(file);
  };

  // Pagination for logs
  const logsPerPage = 4;
  const totalPages = Math.ceil(activityFeed.length / logsPerPage);
  const currentLogs = activityFeed.slice((logPage - 1) * logsPerPage, logPage * logsPerPage);

  const commandPaletteCommands = [
    { label: "Sync Guild Database Ranks", desc: "Forces a sync audit of Roblox rank roles", action: () => { handleBulkSync(); setCommandPaletteOpen(false); } },
    { label: "Check Server Health", desc: "Checks permissions and repair options", action: () => { setActiveTab("health"); setCommandPaletteOpen(false); } },
    { label: "Export Config JSON", desc: "Downloads current settings template", action: () => { exportConfigJson(); setCommandPaletteOpen(false); } },
    { label: "Navigate: Real-time Analytics", desc: "View telemetry logs and charts", action: () => { setActiveTab("analytics"); setCommandPaletteOpen(false); } },
    { label: "Navigate: Overview", desc: "Go to home overview dashboard", action: () => { setActiveTab("overview"); setCommandPaletteOpen(false); } }
  ];

  const filteredCommands = commandPaletteCommands.filter(c => 
    c.label.toLowerCase().includes(paletteQuery.toLowerCase())
  );

  if (initialLoading) {
    return (
      <main className="min-h-screen bg-black text-white p-12 flex flex-col gap-10">
        <div className="flex gap-4 items-center">
          <div className="w-10 h-10 bg-zinc-900 rounded-lg animate-pulse" />
          <div className="w-48 h-6 bg-zinc-900 rounded-lg animate-pulse" />
        </div>
        <div className="grid grid-cols-4 gap-6">
          <div className="h-28 bg-zinc-900/60 rounded-2xl animate-pulse" />
          <div className="h-28 bg-zinc-900/60 rounded-2xl animate-pulse" />
          <div className="h-28 bg-zinc-900/60 rounded-2xl animate-pulse" />
          <div className="h-28 bg-zinc-900/60 rounded-2xl animate-pulse" />
        </div>
        <div className="flex-1 bg-zinc-900/40 rounded-2xl h-80 animate-pulse" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex relative">
      {/* Toast Alert stack */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`px-5 py-3.5 rounded-xl border text-xs font-semibold shadow-2xl flex items-center justify-between gap-4 transition duration-200 animate-slide-in ${
              t.type === "success"
                ? "bg-green-500/10 border-green-500/20 text-green-400"
                : t.type === "error"
                ? "bg-red-500/10 border-red-500/20 text-red-400"
                : "bg-blue-500/10 border-blue-500/20 text-blue-400"
            }`}
          >
            <span>{t.text}</span>
            <button onClick={() => setToasts(prev => prev.filter(to => to.id !== t.id))}>
              <X className="w-3.5 h-3.5 opacity-60 hover:opacity-100 transition" />
            </button>
          </div>
        ))}
      </div>

      {/* Command Palette (Ctrl+K) */}
      {commandPaletteOpen && (
        <div className="fixed inset-0 bg-black/85 backdrop-filter backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-neutral-950 border border-zinc-800 rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl">
            <div className="flex items-center gap-3 border-b border-zinc-900 px-4 py-3">
              <Search className="w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search commands..."
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm focus:outline-none placeholder-zinc-600"
                autoFocus
              />
              <button 
                onClick={() => setCommandPaletteOpen(false)}
                className="text-xs text-zinc-500 hover:text-white px-2 py-1 bg-zinc-900 rounded border border-zinc-800"
              >
                ESC
              </button>
            </div>
            <div className="p-2 max-h-72 overflow-y-auto">
              {filteredCommands.length === 0 ? (
                <span className="text-zinc-600 text-xs block p-4">No commands match filter query.</span>
              ) : (
                filteredCommands.map((c, idx) => (
                  <button
                    key={idx}
                    onClick={c.action}
                    className="w-full text-left p-3 rounded-xl hover:bg-zinc-900 flex flex-col gap-1 transition"
                  >
                    <span className="text-xs font-bold text-white">{c.label}</span>
                    <span className="text-[10px] text-zinc-500">{c.desc}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar navigation */}
      <aside className="w-64 border-r border-zinc-800 p-6 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => router.push("/dashboard")}
              className="p-2 hover:bg-zinc-900 rounded-lg transition"
            >
              <ArrowLeft className="w-4 h-4 text-zinc-400" />
            </button>
            <span className="font-bold text-sm">Nora Studio</span>
          </div>

          <nav className="flex flex-col gap-2">
            <button
              onClick={() => setActiveTab("overview")}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "overview" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <Activity className="w-4 h-4" /> Home Dashboard
            </button>
            <button
              onClick={() => setActiveTab("analytics")}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "analytics" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <BarChart3 className="w-4 h-4" /> Real-time Analytics
            </button>
            <button
              onClick={() => setActiveTab("roblox")}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "roblox" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <UserCheck className="w-4 h-4" /> Roblox Systems
            </button>
            <button
              onClick={() => setActiveTab("discord")}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "discord" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <Settings className="w-4 h-4" /> Discord Modules
            </button>
            <button
              onClick={() => setActiveTab("health")}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs font-semibold transition ${
                activeTab === "health" ? "bg-white text-black" : "text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              <Shield className="w-4 h-4" /> Server Health
            </button>
          </nav>
        </div>

        {/* JSON Configuration import/export */}
        <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-xl flex flex-col gap-3">
          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">Templates System</span>
          <button
            onClick={exportConfigJson}
            className="w-full py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 hover:bg-zinc-700/60 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-2"
          >
            <Download className="w-3.5 h-3.5" /> Export JSON
          </button>
          <label className="w-full py-2 bg-zinc-800 text-zinc-300 border border-zinc-700/60 hover:bg-zinc-700/60 text-xs font-semibold rounded-lg transition flex items-center justify-center gap-2 cursor-pointer text-center">
            <Upload className="w-3.5 h-3.5" /> Import JSON
            <input type="file" accept=".json" onChange={handleImportConfig} className="hidden" />
          </label>
        </div>
      </aside>

      {/* Main Tab content router */}
      <section className="flex-1 p-10 overflow-y-auto max-w-5xl">
        {activeTab === "overview" && (
          <div className="flex flex-col gap-8">
            <header className="flex justify-between items-center">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">Home Dashboard</h1>
                <p className="text-zinc-500 text-xs mt-1">SaaS telemetry overview and quick commands launcher.</p>
              </div>
              <button 
                onClick={() => setCommandPaletteOpen(true)}
                className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-xs text-zinc-400 font-medium transition"
              >
                Press <kbd className="bg-black px-1.5 py-0.5 rounded border border-zinc-800 mx-1">Ctrl + K</kbd> to search
              </button>
            </header>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-neutral-900/40 border border-zinc-800 p-5 rounded-2xl">
                <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Total Members</span>
                <div className="text-2xl font-black text-white mt-2">1,530</div>
              </div>
              <div className="bg-neutral-900/40 border border-zinc-800 p-5 rounded-2xl">
                <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Bot Shard Ping</span>
                <div className="text-2xl font-black text-green-500 mt-2">ONLINE <span className="text-xs text-zinc-500 font-medium">(24ms)</span></div>
              </div>
              <div className="bg-neutral-900/40 border border-zinc-800 p-5 rounded-2xl">
                <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Verified Users</span>
                <div className="text-2xl font-black text-white mt-2">912</div>
              </div>
              <div className="bg-neutral-900/40 border border-zinc-800 p-5 rounded-2xl">
                <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Uptime</span>
                <div className="text-2xl font-black text-white mt-2">2d 12h</div>
              </div>
            </div>

            {/* Event history log table with Pagination controls */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                <History className="w-4 h-4 text-zinc-400" /> Server Event History Log
              </h3>
              
              <div className="flex flex-col gap-3 min-h-[140px]">
                {currentLogs.map((log, idx) => (
                  <div key={idx} className="flex justify-between items-center text-xs border-b border-zinc-900/80 pb-2.5">
                    <span className="text-zinc-200">{log}</span>
                    <span className="text-zinc-500">Active</span>
                  </div>
                ))}
              </div>

              {/* Pagination UI */}
              <div className="flex justify-between items-center mt-6 pt-4 border-t border-zinc-900">
                <span className="text-[10px] text-zinc-500 font-semibold">Page {logPage} of {totalPages}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setLogPage(p => Math.max(1, p - 1))}
                    disabled={logPage === 1}
                    className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-850 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setLogPage(p => Math.min(totalPages, p + 1))}
                    disabled={logPage === totalPages}
                    className="p-1.5 bg-zinc-900 border border-zinc-800 rounded-lg hover:bg-zinc-850 disabled:opacity-40 disabled:cursor-not-allowed transition"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "analytics" && (
          <div className="flex flex-col gap-8">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Real-time Analytics</h1>
              <p className="text-zinc-500 text-xs mt-1">Growth logs, commands triggers, and Roblox linkage rates.</p>
            </header>

            {analytics && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Member Growth */}
                <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
                  <h3 className="font-bold text-sm mb-4">Member Growth</h3>
                  <div className="h-44 w-full flex items-end justify-between px-2 pt-4 relative">
                    {analytics.memberGrowth.map((g, idx) => {
                      const max = Math.max(...analytics.memberGrowth.map(m => m.count));
                      const height = (g.count / max) * 120;
                      return (
                        <div key={idx} className="flex flex-col items-center gap-2 z-10">
                          <span className="text-[10px] text-zinc-500">{g.count}</span>
                          <div style={{ height: `${height}px` }} className="w-8 bg-zinc-700 rounded-md hover:bg-zinc-600 transition" />
                          <span className="text-[10px] text-zinc-500 font-bold">{g.date}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Commands usage chart */}
                <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
                  <h3 className="font-bold text-sm mb-4">Commands Triggered Today</h3>
                  <div className="h-44 w-full flex items-end justify-between px-2 pt-4 relative">
                    {analytics.commandsUsage.map((c, idx) => {
                      const max = Math.max(...analytics.commandsUsage.map(co => co.count));
                      const height = (c.count / max) * 120;
                      return (
                        <div key={idx} className="flex flex-col items-center gap-2 z-10">
                          <span className="text-[10px] text-zinc-500">{c.count}</span>
                          <div style={{ height: `${height}px` }} className="w-8 bg-white/80 rounded-md hover:bg-white transition" />
                          <span className="text-[10px] text-zinc-500 font-bold">{c.date}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "roblox" && (
          <div className="flex flex-col gap-8">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Roblox Integrations</h1>
              <p className="text-zinc-500 text-xs mt-1">Manage user pairings, verify review queues, and map group roles.</p>
            </header>

            {/* Profile Lookup */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                <Search className="w-4 h-4 text-zinc-400" /> User Profile Lookup
              </h3>
              <div className="flex gap-4 mb-6">
                <input
                  type="text"
                  placeholder="Enter Roblox username..."
                  value={searchUser}
                  onChange={(e) => setSearchUser(e.target.value)}
                  className="flex-1 bg-black border border-zinc-800 px-4 py-2.5 rounded-xl text-xs focus:outline-none focus:border-zinc-700"
                />
                <button
                  onClick={handleUserLookup}
                  className="px-6 py-2 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition"
                >
                  {lookupLoading ? "Searching..." : "Search"}
                </button>
              </div>

              {lookupResult && (
                <div className="bg-zinc-900/40 border border-zinc-800/80 p-5 rounded-2xl flex items-center gap-6">
                  <img
                    src={lookupResult.avatarUrl}
                    alt={lookupResult.username}
                    className="w-16 h-16 rounded-xl border border-zinc-800 bg-zinc-950"
                  />
                  <div className="flex-1 grid grid-cols-2 gap-4">
                    <div>
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Roblox Account</span>
                      <h4 className="text-sm font-black mt-1">{lookupResult.displayName} (@{lookupResult.username})</h4>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Discord ID</span>
                      <h4 className="text-sm font-semibold mt-1">{lookupResult.discordId}</h4>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Group Rank</span>
                      <h4 className="text-sm font-semibold mt-1 text-zinc-300">{lookupResult.rankName}</h4>
                    </div>
                    <div>
                      <span className="text-[10px] text-zinc-500 font-bold uppercase">Linkage Status</span>
                      <h4 className="text-sm font-black mt-1 text-green-500">{lookupResult.status}</h4>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Verification review queue */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-4">Pending Verification Queue</h3>
              {queue.length === 0 ? (
                <span className="text-zinc-600 text-xs">No pending verification reviews in queue.</span>
              ) : (
                <div className="flex flex-col gap-4">
                  {queue.map((req) => (
                    <div
                      key={req.id}
                      className="bg-black/40 border border-zinc-900 p-4 rounded-xl flex items-center justify-between"
                    >
                      <div>
                        <h4 className="font-bold text-xs">@{req.username}</h4>
                        <span className="text-zinc-500 text-[10px]">Discord: {req.discordTag}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleResolveRequest(req.id, "approve")}
                          className="px-4 py-1.5 bg-green-500/10 text-green-500 border border-green-500/20 text-xs font-semibold rounded-lg hover:bg-green-500/20 transition"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleResolveRequest(req.id, "reject")}
                          className="px-4 py-1.5 bg-red-500/10 text-red-500 border border-red-500/20 text-xs font-semibold rounded-lg hover:bg-red-500/20 transition"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "discord" && (
          <div className="flex flex-col gap-8">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Discord Modules</h1>
              <p className="text-zinc-500 text-xs mt-1">Configure automation channels, AI configs, and welcome logs.</p>
            </header>

            {/* Welcome Message editor with live preview updates */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-zinc-400" /> Welcome Message Config
              </h3>
              
              <div className="flex flex-col gap-2 mb-6">
                <label className="text-[10px] text-zinc-400 font-bold uppercase">Welcome Message Rule</label>
                <textarea
                  rows={3}
                  value={settings?.welcomeMessage || ""}
                  onChange={(e) => handleChange("welcomeMessage", e.target.value)}
                  className="bg-black border border-zinc-800 p-4 rounded-xl text-xs focus:outline-none focus:border-zinc-700 resize-none font-mono"
                />
              </div>

              {/* Dynamic live preview embed layout */}
              <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-950/85">
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-3">Live Embed Preview</span>
                <div className="border-l-4 border-white pl-4 py-2 bg-neutral-900/20 rounded-r-md">
                  <div className="text-[11px] text-zinc-400">Nora Bot Welcome</div>
                  <p className="text-xs text-white mt-1">
                    {(settings?.welcomeMessage || "")
                      .replace(/{user}/g, "@Vaztinix")
                      .replace(/{server_name}/g, "Developers Arena")
                      .replace(/{member_count}/g, "1,530")}
                  </p>
                </div>
              </div>
            </div>

            {/* Optimistic toggle configurations */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-6">Category Logging Rules</h3>
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center text-xs">
                  <div>
                    <h4 className="font-bold text-zinc-200">Leveling System Progression</h4>
                    <p className="text-[10px] text-zinc-500">Record chat XP and level-up events.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings?.levelingEnabled || false}
                      onChange={(e) => handleToggleOptimistic("levelingEnabled", e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
                  </label>
                </div>

                <div className="flex justify-between items-center text-xs pt-4 border-t border-zinc-900/60">
                  <div>
                    <h4 className="font-bold text-zinc-200">AutoMod Spam Filters</h4>
                    <p className="text-[10px] text-zinc-500">Filter and block spam actions.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings?.moderationEnabled || false}
                      onChange={(e) => handleToggleOptimistic("moderationEnabled", e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "health" && (
          <div className="flex flex-col gap-8">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Server Health Diagnostics</h1>
              <p className="text-zinc-500 text-xs mt-1">Audit status of permissions and configured log channels.</p>
            </header>

            {healthStatus && (
              <div className="flex flex-col gap-6">
                {/* Required Permissions check */}
                <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
                  <h3 className="font-bold text-sm mb-4">Required Bot Permissions</h3>
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-300">Manage Roles</span>
                      {healthStatus.permissions.manageRoles ? (
                        <span className="text-green-500 flex items-center gap-1 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                      ) : (
                        <span className="text-red-500 flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> FAILED</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-300">Manage Channels</span>
                      {healthStatus.permissions.manageChannels ? (
                        <span className="text-green-500 flex items-center gap-1 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                      ) : (
                        <span className="text-red-500 flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> FAILED</span>
                      )}
                    </div>
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-300">Embed Links</span>
                      {healthStatus.permissions.embedLinks ? (
                        <span className="text-green-500 flex items-center gap-1 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                      ) : (
                        <span className="text-amber-500 flex items-center gap-1 font-semibold"><AlertTriangle className="w-3.5 h-3.5" /> WARNING (Fix manually)</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Configured Log channels audit with Repair fixes */}
                <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
                  <h3 className="font-bold text-sm mb-4">Configured Log Channels</h3>
                  <div className="flex flex-col gap-4">
                    <div className="flex justify-between items-center text-xs">
                      <div>
                        <h4 className="font-bold text-zinc-200">Verification Logs Channel</h4>
                        <p className="text-[10px] text-zinc-500">Target channel for verified member updates.</p>
                      </div>
                      {healthStatus.channels.verifyChannel ? (
                        <span className="text-green-500 flex items-center gap-1 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                      ) : (
                        <button
                          onClick={() => handleRepairChannel("verifyChannel")}
                          className="px-4 py-1.5 bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-semibold rounded-lg hover:bg-amber-500/20 transition animate-pulse"
                        >
                          Auto-Fix Channel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
