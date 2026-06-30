"use client";

import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useParams, useRouter } from "next/navigation";
import { Shield, ArrowLeft, RefreshCw, Sparkles, CheckCircle2 } from "lucide-react";

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

export default function GuildConfig() {
  const params = useParams();
  const router = useRouter();
  const guildId = params.guildId as string;

  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // 1. Fetch current settings from database
    const fetchSettings = async () => {
      try {
        const res = await axios.get(`http://localhost:4000/api/guilds/${guildId}/settings`, {
          withCredentials: true
        });
        setSettings(res.data);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    fetchSettings();

    // 2. Establish live WebSocket connection
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
          setUnsaved(false); // updates aligned from server
        }
      } catch (e) {
        console.error("WebSocket message parsing error:", e);
      }
    };

    return () => {
      ws.close();
    };
  }, [guildId]);

  const handleChange = (key: keyof GuildSettings, value: any) => {
    if (!settings) return;
    setSettings({
      ...settings,
      [key]: value
    });
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

  if (!settings) {
    return (
      <main className="min-h-screen bg-black text-white flex items-center justify-center">
        <span className="text-zinc-500 animate-pulse text-sm">Initializing config workspace...</span>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <header className="flex justify-between items-center mb-10 border-b border-zinc-800 pb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push("/dashboard")}
              className="p-2 hover:bg-zinc-900 rounded-xl transition duration-200"
            >
              <ArrowLeft className="w-5 h-5 text-zinc-400" />
            </button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold tracking-tight">Configuration Hub</h1>
                {unsaved && (
                  <span className="bg-amber-500/10 text-amber-500 text-xs px-2 py-0.5 rounded-md font-medium border border-amber-500/20">
                    Unsaved Changes
                  </span>
                )}
              </div>
              <p className="text-zinc-500 text-sm">Settings sync instantly to the bot cache on save.</p>
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={!unsaved || saving}
            className={`px-5 py-2 rounded-xl text-sm font-semibold transition duration-200 ${
              unsaved
                ? "bg-white text-black hover:bg-zinc-200"
                : "bg-zinc-900 text-zinc-600 cursor-not-allowed border border-zinc-800"
            }`}
          >
            {saving ? "Saving Changes..." : "Save Settings"}
          </button>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Leveling System Configuration */}
          <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-bold text-sm">Leveling System</h3>
                <p className="text-zinc-500 text-xs mt-1">Enable user progression rewards.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.levelingEnabled}
                  onChange={(e) => handleChange("levelingEnabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
              </label>
            </div>
          </div>

          {/* Moderation Configuration */}
          <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-bold text-sm">AutoMod Protection</h3>
                <p className="text-zinc-500 text-xs mt-1">Configure automated moderation actions.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.moderationEnabled}
                  onChange={(e) => handleChange("moderationEnabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
              </label>
            </div>
          </div>

          {/* Roblox Linkage Configurations */}
          <div className="bg-neutral-900/30 border border-zinc-800 rounded-2xl p-6 md:col-span-2">
            <div className="flex justify-between items-center mb-6 border-b border-zinc-800 pb-4">
              <div>
                <h3 className="font-bold text-sm">Roblox Identity Core</h3>
                <p className="text-zinc-500 text-xs mt-1">Bind Roblox accounts to Discord roles via secure OAuth2 tokens.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.robloxVerifyEnabled}
                  onChange={(e) => handleChange("robloxVerifyEnabled", e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white peer-checked:after:bg-black"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <label className="text-xs text-zinc-400 font-semibold">Verified Discord Role ID</label>
                <input
                  type="text"
                  placeholder="Enter role ID (e.g. 1214048435)"
                  value={settings.robloxVerifyRoleId || ""}
                  onChange={(e) => handleChange("robloxVerifyRoleId", e.target.value || null)}
                  className="bg-black border border-zinc-800 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-zinc-600 transition"
                />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-xs text-zinc-400 font-semibold">Verification Channel ID</label>
                <input
                  type="text"
                  placeholder="Enter channel ID"
                  value={settings.robloxVerifyChannelId || ""}
                  onChange={(e) => handleChange("robloxVerifyChannelId", e.target.value || null)}
                  className="bg-black border border-zinc-800 px-4 py-2.5 rounded-xl text-sm focus:outline-none focus:border-zinc-600 transition"
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
