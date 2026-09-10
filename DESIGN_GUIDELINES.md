# Nora Bot — Human Design Principles & Guidelines

This document serves as the design and writing standard for the Nora Discord bot and web ecosystem. It defines what makes an interface look and feel authentically human-engineered rather than AI-generated, and provides strict rules to prevent AI-style tropes across all bot messages, embeds, graphics, and web pages.

---

## 1. Why Things Look "AI-Generated" (The Anti-Patterns)

When users perceive an interface, embed, or message as "AI slop", it is almost always triggered by one or more of these 5 factors:

### Factor 1: Emoji Saturation & Prefixing
* **The AI Symptom**: Placing an emoji at the beginning of *every single line*, *every field header*, and *every button*.
  * *Bad (AI)*:
    ```
    📈 Leveling & Rank Stats
    💎 Nora Premium & Status
    🛡️ Server & Security Identity
    🏷️ Top Server Roles
    🎮 Roblox Integration
    🏆 Nora Badges
    🎉 Special Events
    Buttons: [🔄 Refresh Card] [🎨 Customize Card] [🗑️ Delete My Data]
    ```
* **The Human Fix**: Use clear, semantic typography and standard markdown headers. Omit emojis from field headers entirely. Reserve emojis strictly for functional status indicators (e.g. online/offline dots `●`) or verified user-earned badges.

### Factor 2: Over-Saturated Gradients & Neon Glow Cliché
* **The AI Symptom**: Excessive purple-to-cyan, magenta-to-yellow gradients, heavy rainbow drop-shadows, and neon glow effects on cards and canvases.
* **The Human Fix**: Use structured, intentional dark palettes:
  * Base: Obsidian, zinc, and dark slate (`#090a0f`, `#12131a`, `#1e202e`).
  * Accents: Deep cobalt (`#5865F2`), crisp teal (`#0ea5e9`), or subtle warm amber (`#f59e0b`).
  * Borders: 1px subtle glass borders (`rgba(255, 255, 255, 0.08)`).
  * Gradients should be subtle ambient backgrounds (0.10 opacity max), never high-contrast rainbow banners.

### Factor 3: Corporate Buzzword Jargon & Over-Polite Sycophancy
* **The AI Symptom**:
  * "Our team is fine-tuning Nora's next-generation AI model for higher speed and better accuracy. We appreciate your patience while this upgrade is in progress!"
  * "Delivers state-of-the-art neural synergy and unmatched server architecture."
  * "Certainly! I would be delighted to assist you with..."
* **The Human Fix**: Direct, authentic, engineering-first communication:
  * "This feature is currently offline for maintenance."
  * "Formula: `5 * (Level ^ 2) + 50 * Level + 100`"
  * "Showing 42 active servers and 1,830 unique members."

### Factor 4: Cluttered Embed Formatting & Visual Noise
* **The AI Symptom**: Stacking triple blockquotes (`>>>`), excessive horizontal separators, double bracket gauges (`[ ░░░░░ ] 30%`), and redundant labels like `*Total: 13,309 XP*` placed right next to `Total: 13,309 XP`.
* **The Human Fix**: Scannable, dense, clean data presentation with clear visual hierarchy:
  * Clean progress bars: `[████░░░░░░] 40% (934 / 2,335 XP)`
  * Key-value lines: `Level: 11  •  Rank: #1  •  Total XP: 13,309`

### Factor 5: Robotic Error Messages & Generic Warnings
* **The AI Symptom**: Robotic titles like `Security Violation: Identity Mismatch Detected` or `Error Code 403: Execution Terminated`.
* **The Human Fix**: Natural, actionable feedback:
  * "You can only wipe your own leveling data."
  * "Please specify a valid member."

---

## 2. Practical Checklist for New Commands & Embeds

Before committing any command, embed, or image generator, verify against this checklist:

- [ ] **Field Headers**: Are all embed field headers plain text without decorative emojis? (e.g. `Leveling & Rank` instead of `📈 Leveling & Rank Stats`)
- [ ] **Buttons**: Are action buttons labeled clearly with verbs/nouns rather than emoji strings? (`Refresh`, `Customize`, `Delete Data`)
- [ ] **Voice / Tone**: Is the text written in natural, concise human English without robotic hype or corporate apologies?
- [ ] **Gradients**: Are canvas images and SVG cards using clean obsidian/slate themes instead of high-saturation rainbow gradients?
- [ ] **Data Density**: Is information organized logically with high scannability and no redundant filler lines?
- [ ] **Authorization**: Do interactive buttons explicitly bind to the user ID without relying on regex scraping of footer text?

---

## 3. Approved Nora Style Tokens

| Element | Specification | Example |
| :--- | :--- | :--- |
| **Embed Embed Color** | Discord Blurple (`#5865F2`), Slate (`#4F545C`), or Status Gold (`#F59E0B`) | `0x5865F2` |
| **Status Indicators** | Single clean dot or plain text | `● Online`, `○ Offline` |
| **Badge Styling** | Bracketed monospace tags or clean badges | `[Founder]`, `[Studio Premium]`, `[Active Dev]` |
| **Progress Bar** | Minimalist block characters | `[████░░░░░░] 40%` |
| **Footer Text** | Clean breadcrumb or contextual note | `Nora • vaztinix.dev` |
