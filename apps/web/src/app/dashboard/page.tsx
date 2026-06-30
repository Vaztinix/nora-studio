"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { Server, Shield, Crown } from "lucide-react";

interface Guild {
  id: string;
  name: string;
  icon: string | null;
  features: string[];
}

export default function Dashboard() {
  const [guilds, setGuilds] = useState<Guild[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchGuilds = async () => {
      try {
        const res = await axios.get("http://localhost:4000/api/guilds", {
          withCredentials: true
        });
        setGuilds(res.data);
      } catch (e) {
        console.error("Failed to load guilds:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchGuilds();
  }, []);

  return (
    <main className="min-h-screen bg-black text-white p-8">
      <header className="max-w-6xl mx-auto mb-10 flex justify-between items-center border-b border-zinc-800 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Select Server</h1>
          <p className="text-zinc-500 text-sm">Choose a server you manage to configure Nora Studio.</p>
        </div>
      </header>

      <section className="max-w-6xl mx-auto">
        {loading ? (
          <div className="flex justify-center py-20">
            <span className="text-zinc-500 text-sm animate-pulse">Loading servers...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {guilds.map((g) => {
              const iconUrl = g.icon
                ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`
                : null;

              return (
                <div
                  key={g.id}
                  className="bg-neutral-900/40 border border-zinc-800/80 rounded-2xl p-6 flex flex-col justify-between hover:border-zinc-700/80 transition duration-200"
                >
                  <div className="flex items-center gap-4 mb-6">
                    {iconUrl ? (
                      <img
                        src={iconUrl}
                        alt={g.name}
                        className="w-12 h-12 rounded-xl object-cover border border-zinc-800"
                      />
                    ) : (
                      <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center">
                        <Server className="w-5 h-5 text-zinc-400" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-bold text-sm truncate">{g.name}</h3>
                      <span className="text-zinc-500 text-xs">ID: {g.id}</span>
                    </div>
                  </div>

                  <Link
                    href={`/dashboard/${g.id}`}
                    className="w-full text-center py-2.5 bg-white text-black font-semibold text-sm rounded-xl hover:bg-zinc-200 transition duration-200"
                  >
                    Configure Settings
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
