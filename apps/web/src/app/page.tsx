"use client";

import React from "react";
import axios from "axios";

export default function Home() {
  const handleLogin = async () => {
    try {
      const res = await axios.get("http://localhost:4000/api/auth/login");
      window.location.href = res.data.url;
    } catch (e) {
      console.error("Login failed:", e);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-black px-4 relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[350px] h-[350px] bg-white/5 rounded-full filter blur-[90px] pointer-events-none" />
      
      <div className="relative z-10 text-center max-w-xl">
        <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-white mb-4">
          Nora Studio
        </h1>
        <p className="text-zinc-400 text-base sm:text-lg mb-8 leading-relaxed">
          Manage your Discord bot systems and Roblox integrations in real time from a single, unified command center.
        </p>
        <button
          onClick={handleLogin}
          className="inline-flex items-center gap-2 px-8 py-3 bg-white text-black font-semibold text-sm rounded-xl hover:bg-neutral-200 transition duration-200 shadow-lg shadow-white/5"
        >
          Login with Discord
        </button>
      </div>
    </main>
  );
}
