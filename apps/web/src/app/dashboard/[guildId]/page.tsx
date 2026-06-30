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
  FileText, 
  MessageSquare,
  Search,
  Sparkles,
  Bot
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

export default function GuildConfig() {
  const params = useParams();
  const router = useRouter();
  const guildId = params.guildId as string;

  const [activeTab, setActiveTab] = useState<"overview" | "analytics" | "roblox" | "discord" | "health">("overview");
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Verification queue & lookup states
  const [queue, setQueue] = useState<RobloxQueueItem[]>([]);
  const [searchUser, setSearchUser] = useState("");
  const [lookupResult, setLookupResult] = useState<RobloxProfile | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Analytics & Health states
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [activityFeed, setActivityFeed] = useState<string[]>([
    "Jane verified Roblox account Telamon",
    "Mike changed welcome channel destination",
    "AutoMod flagged suspicious link in chat",
    "2 users verified today"
  ]);

  const wsRef = useRef<WebSocket | null>(null);

  // 1. Fetch initial API data
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
        setAnalytics(analyticsRes.data);
        setQueue(queueRes.data);
        setHealthStatus(healthRes.data);
      } catch (e) {
        console.error("Failed to load server configurations:", e);
      }
    };
    fetchData();

    // Establish real-time WebSocket connection
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
          setUnsaved(false);
        } else if (data.event === "USER_VERIFIED") {
          setActivityFeed(prev => [`User verified: ${data.robloxUsername}`, ...prev]);
        }
      } catch (e) {
        console.error("Failed to parse WebSocket sync event:", e);
      }
    };

    return () => {
      ws.close();
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
      await axios.patch(`http://localhost:4000/api/guilds/${guildId}/settings`, settings, {
        withCredentials: true
      });
      setUnsaved(false);
    } catch (e) {
      console.error("Failed to save settings:", e);
    } finally {
      setSaving(false);
    }
  };

  // Roblox lookup
  const handleUserLookup = async () => {
    if (!searchUser) return;
    setLookupLoading(true);
    try {
      const res = await axios.get(`http://localhost:4000/api/guilds/${guildId}/roblox/lookup/${searchUser}`, {
        withCredentials: true
      });
      setLookupResult(res.data);
    } catch (e) {
      console.error("Failed to fetch Roblox user:", e);
    } finally {
      setLookupLoading(false);
    }
  };

  // Resolve review item
  const handleResolveRequest = async (requestId: string, action: "approve" | "reject") => {
    try {
      await axios.post(`http://localhost:4000/api/guilds/${guildId}/roblox/queue/${requestId}/resolve`, { action }, {
        withCredentials: true
      });
      setQueue(prev => prev.filter(r => r.id !== requestId));
    } catch (e) {
      console.error("Failed to resolve verification request:", e);
    }
  };

  // Bulk sync trigger
  const handleBulkSync = async () => {
    setSyncing(true);
    try {
      await axios.post(`http://localhost:4000/api/guilds/${guildId}/roblox/sync`, {}, {
        withCredentials: true
      });
      setTimeout(() => {
        setSyncing(false);
        setActivityFeed(prev => ["Bulk synchronization task completed.", ...prev]);
      }, 3000);
    } catch (e) {
      console.error("Failed to trigger sync:", e);
      setSyncing(false);
    }
  };

  // Repair diagnostic channel
  const handleRepairChannel = async (channelType: string) => {
    try {
      await axios.post(`http://localhost:4000/api/guilds/${guildId}/diagnostics/repair`, { channelType }, {
        withCredentials: true
      });
      // Refresh configurations state
      const res = await axios.get(`http://localhost:4000/api/guilds/${guildId}/settings`, { withCredentials: true });
      setSettings(res.data);
      setHealthStatus((prev: any) => ({
        ...prev,
        channels: {
          ...prev.channels,
          [channelType]: true
        }
      }));
    } catch (e) {
      console.error("Failed to repair channel:", e);
    }
  };

  if (!settings) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <span className="text-zinc-500 animate-pulse text-sm">Initializing config workspace...</span>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white flex">
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

        {unsaved && (
          <div className="bg-zinc-900/60 border border-zinc-800 p-4 rounded-xl flex flex-col gap-2">
            <span className="text-[10px] text-amber-500 font-bold uppercase tracking-wider">Unsaved Changes</span>
            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full text-center py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-zinc-200 transition"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        )}
      </aside>

      {/* Main tab wrapper content */}
      <section className="flex-1 p-10 overflow-y-auto max-w-5xl">
        {activeTab === "overview" && (
          <div className="flex flex-col gap-8">
            <header>
              <h1 className="text-2xl font-bold tracking-tight">Home Dashboard</h1>
              <p className="text-zinc-500 text-xs mt-1">Status, recent logs, and quick actions overview.</p>
            </header>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-neutral-900/40 border border-zinc-800 p-5 rounded-2xl">
                <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Total Members</span>
                <div className="text-2xl font-black text-white mt-2">1,530</div>
              </div>
              <div className="bg-neutral-900/40 border border-zinc-800 p-5 rounded-2xl">
                <span className="text-zinc-500 text-xs font-bold uppercase tracking-wider">Active Shard</span>
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

            {/* Live activity & quick actions */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {/* Activity Feed */}
              <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6 md:col-span-2">
                <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-zinc-400" /> Recent Event Activity
                </h3>
                <div className="flex flex-col gap-3">
                  {activityFeed.map((feed, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs border-b border-zinc-900 pb-2">
                      <span className="text-zinc-200">{feed}</span>
                      <span className="text-zinc-500">Just now</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
                <h3 className="font-bold text-sm mb-4">Quick Tools</h3>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={handleBulkSync}
                    className="w-full text-left px-4 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-semibold rounded-xl transition"
                  >
                    Force Roblox Sync
                  </button>
                  <button
                    onClick={() => setActiveTab("health")}
                    className="w-full text-left px-4 py-2.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs font-semibold rounded-xl transition"
                  >
                    Run Diagnostics Check
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
                {/* Member Growth Trajectory */}
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

                {/* Commands Usage */}
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
                  className="flex-1 bg-black border border-zinc-800 px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-zinc-700"
                />
                <button
                  onClick={handleUserLookup}
                  className="px-6 py-2 bg-white text-black text-xs font-bold rounded-xl hover:bg-zinc-200 transition"
                >
                  {lookupLoading ? "Loading..." : "Search"}
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

            {/* Verification review Queue */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-4">Pending Verification Queue</h3>
              {queue.length === 0 ? (
                <span className="text-zinc-500 text-xs">No pending verification reviews in queue.</span>
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

            {/* Welcome Editor and Live Preview */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-zinc-400" /> Welcome Message Config
              </h3>
              
              <div className="flex flex-col gap-2 mb-6">
                <label className="text-[10px] text-zinc-400 font-bold uppercase">Welcome Message Rule</label>
                <textarea
                  rows={3}
                  value={settings.welcomeMessage}
                  onChange={(e) => handleChange("welcomeMessage", e.target.value)}
                  className="bg-black border border-zinc-800 p-4 rounded-xl text-xs focus:outline-none focus:border-zinc-700 resize-none font-mono"
                />
              </div>

              {/* Dynamic Live Preview Box */}
              <div className="border border-zinc-800 rounded-xl p-4 bg-zinc-950/80">
                <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-3">Live Embed Preview</span>
                <div className="border-l-4 border-white pl-4 py-2 bg-neutral-900/20 rounded-r-md">
                  <div className="text-[11px] text-zinc-400">Nora Bot Welcome</div>
                  <p className="text-xs text-white mt-1">
                    {settings.welcomeMessage
                      .replace(/{user}/g, "@Vaztinix")
                      .replace(/{server_name}/g, "Developers Arena")
                      .replace(/{member_count}/g, "1,530")}
                  </p>
                </div>
              </div>
            </div>

            {/* Logging Category Configuration */}
            <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-sm mb-6">Category Logging Rules</h3>
              <div className="flex flex-col gap-4">
                <div className="flex justify-between items-center text-xs">
                  <div>
                    <h4 className="font-bold text-zinc-200">Moderation Audits</h4>
                    <p className="text-[10px] text-zinc-500">Record ban, warning, and kick actions.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.reactionRoleNotifyDm}
                      onChange={(e) => handleChange("reactionRoleNotifyDm", e.target.checked)}
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
                {/* Permissions Diagnostics */}
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

                {/* Channels Configuration Diagnostics */}
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
