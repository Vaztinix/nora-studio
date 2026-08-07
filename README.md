<div align="center">

# ✨ Nora Studio

### **Privacy-First AI & Next-Gen Moderation Ecosystem for Discord**

<p align="center">
  <a href="https://vaztinix.dev"><img src="https://img.shields.io/badge/Website-vaztinix.dev-7C3AED?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Website" /></a>
  <a href="https://top.gg/user/593420060990005248"><img src="https://img.shields.io/badge/Top.gg-Approved_Bot-FF3366?style=for-the-badge&logo=top.gg&logoColor=white" alt="Top.gg" /></a>
  <a href="https://discord.com/users/1214048435632603137"><img src="https://img.shields.io/badge/Discord-Join_Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" /></a>
  <a href="https://github.com/Vaztinix/nora-studio"><img src="https://img.shields.io/badge/Version-2.5_Stable-10B981?style=for-the-badge&logo=github&logoColor=white" alt="Version" /></a>
  <a href="#-privacy-first-philosophy"><img src="https://img.shields.io/badge/Privacy-Zero--Access-00B4D8?style=for-the-badge&logo=shield&logoColor=white" alt="Privacy" /></a>
  <a href="https://www.botboard.gg/bots/nora?ref=badge"><img src="https://www.botboard.gg/api/badge/nora?type=servers" alt="BotBoard" /></a>
  <a href="https://www.botboard.gg/bots/nora?ref=badge"><img src="https://www.botboard.gg/api/badge/nora?type=votes" alt="BotBoard" /></a>
  <a href="https://www.botboard.gg/bots/nora?ref=badge"><img src="https://www.botboard.gg/api/badge/nora?type=health" alt="BotBoard" /></a>
  <a href="https://www.botboard.gg/bots/nora?ref=badge"><img src="https://www.botboard.gg/api/badge/nora?type=rating" alt="BotBoard" /></a>
</p>

<img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=20&pause=1200&color=A970FF&center=true&vCenter=true&width=600&lines=Moderation+made+simple;Automation+that+respects+privacy;Roblox+Verification+%26+Group+Sync;Starboard+v2.5+%26+Custom+Rank+Cards;Built+for+modern+Discord+communities" alt="Typing Banner" />

</div>

---

## What is Nora?

**Nora** is a high-performance, privacy-first Discord ecosystem engineered to provide elite community moderation, Roblox identity verification, engagement leveling, and server telemetry without compromising user privacy.

Unlike legacy Discord bots that hoard user data or spam permissions, Nora operates under a strict **Zero-Access Architecture**:
- **No Permanent Message Storage:** Chat content is processed in volatile memory only for AutoMod/AI checks and discarded instantly.
- **Zero Developer Backdoors:** Developers have no backend overrides to inspect private chats, server logs, or member statistics.
- **User Sovereignty:** Members can run `/mycard` to inspect their data and hit **Erase Data** for an immediate, irreversible wipe.

---

## Key Feature Modules

| Module | Version | Description |
| :--- | :---: | :--- |
| **Security & Anti-Raid** | `v2.1` | Velocity join limiters, account age enforcement, avatar requirements, suspicious nickname filtering, and 1-click server lockdown. |
| **Roblox Verification** | `v2.4` | Real-time Roblox identity linking, group rank role bindings, nickname sync, and server access gating. |
| **Starboard System** | `v2.5` | Reaction voting highlights, custom emojis, star count thresholds, branded webhook posts, and **Ignored Channels filter**. |
| **Leveling & Rank Cards** | `v2.3` | Voice & text XP algorithms, role rewards, leaderboards, and custom rank card design studio (custom colors, borders, image uploads). |
| **Support Ticketing** | `Beta` | Help desk reaction panels, staff routing, automated transcripts, and auto-category archiving. |
| **AI & Autoresponder** | `v2.1` | Dual-AI engine (Local Aura V10 & Gemini/OpenAI), regex autoresponders, and smart intent classifier (Targeted vs. Casual context). |
| **Nora Studio Dashboard** | `v2.5` | Web-based management portal with real-time sync, unsaved changes guards, and server telemetry. |

---

## 🛠️ Core System Architecture

```mermaid
flowchart TD
    A["Discord API & Gateway"] --> B["Nora Core Router"]
    B --> C{"Permission Hiding Check"}
    C -->|"Staff Member"| D["Mod Commands (/warn, /case, /setup)"]
    C -->|"Community Member"| E["Member Commands (/verify, /mycard, /rank)"]
    B --> F["Real-Time AutoMod Engine"]
    F -->|"Targeted Harassment"| G["Delete Message + Log DB Warning + Timeout Escalation"]
    F -->|"Casual Expression"| H["Gentle Deletion + Ephemeral Notice"]
    F -->|"Mention Limit Exceeded"| I["Immediate Deletion + Staff Alert Log"]
    B --> J["Starboard Engine v2.5"]
    J -->|"Check Ignored Channels"| K{"Is Channel Ignored?"}
    K -->|"Yes"| L["Bypass Reaction Tracking"]
    K -->|"No"| M["Post Branded Webhook Embed"]
```


---

## Privacy-First Philosophy

Nora is built around complete user sovereignty. Server administrators and individual members maintain total control over their data:

```
┌─────────────────────────────────────────────────────────┐
│                    NORA LIMITED ACCESSS DATA            │
├─────────────────────────────────────────────────────────┤
│ • Guild Settings : Stored securely per server ID        │
│ • Level & XP     : Isolated to local guild context      │
│ • Roblox Link    : Hashed ID association                │
│ • Message Content: NEVER stored on disk                 │
│ • User Control   : /mycard ➜ Instant "Erase Data" Wipe │
└─────────────────────────────────────────────────────────┘
```

---

## Developer & Official Links

<div align="center">

### **Created with passion by Vaztinix**

| Platform | Direct Link |
| :--- | :--- |
| **Archived Website** | [vaztinix.github.io/Nora](https://vaztinix.github.io/Nora) |
| **Official Website** | [vaztinix.dev](https://vaztinix.dev) |
| **Developer Profile** | [vaztinix.dev/me](https://vaztinix.dev/me) |
| **Top.gg Profile** | [top.gg/user/593420060990005248](https://top.gg/user/593420060990005248) |
| **GitHub Repository** | [github.com/Vaztinix/nora-studio](https://github.com/Vaztinix/nora-studio) |
| **Discord Profile** | [discord.com/users/1214048435632603137](https://discord.com/users/1214048435632603137) |
| **Contact me** | [vaztinixstudios@gmail.com](mailto:vaztinixstudios@gmail.com) |

<br>

*Built with curiosity, precision, and a belief that privacy should always be the default.*

</div>
