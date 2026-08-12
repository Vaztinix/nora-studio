# 🚀 Self-Hosting Guide for Nora Studio

This guide provides step-by-step instructions for installing, configuring, and self-hosting **Nora** on your own server or local machine.

---

## 📋 System Requirements

- **Operating System:** Windows, Linux (Ubuntu/Debian), or macOS
- **Node.js:** Runtime `v18.0.0` or higher (`node -v`)
- **Git:** Latest version
- **Discord Bot Token:** Issued by the [Discord Developer Portal](https://discord.com/developers/applications)

---

## 🛠️ Step 1: Clone the Codebase

Clone the official repository to your hosting machine:

```bash
git clone https://github.com/Vaztinix/nora-studio.git
cd nora-studio
```

---

## 📦 Step 2: Install Node.js Dependencies

Install all required packages and engines:

```bash
npm install
```

---

## ⚙️ Step 3: Environment Configuration (`.env`)

1. Copy the example configuration template:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` in a text editor (e.g. `nano .env` or VS Code) and set your tokens:

   ```env
   # Server Port
   PORT=3000

   # Discord Bot Token (Required)
   TOKEN=your_discord_bot_token_here

   # Public Web Dashboard URL (e.g. http://localhost:3000 or https://yourdomain.com)
   API_BASE_URL=http://localhost:3000

   # Optional AI Keys (For AI Chatbot & AutoMod)
   OPENAI_API_KEY=your_openai_api_key_here
   GEMINI_API_KEY=your_gemini_api_key_here
   ```

---

## 🔑 Step 4: Configure Discord Developer Portal Intents

For Nora's AutoMod, Anti-Raid, Leveling, and Game features to function:

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select your Application and click **Bot** on the left menu.
3. Scroll down to **Privileged Gateway Intents** and enable:
   - ✅ **Server Members Intent** (`GUILD_MEMBERS`)
   - ✅ **Presence Intent** (`GUILD_PRESENCES`)
   - ✅ **Message Content Intent** (`MESSAGE_CONTENT`)
4. Click **Save Changes**.

---

## 🏗️ Step 5: Build Web Dashboard Assets

Run the build bundler to generate production web assets in `/dist`:

```bash
npm run build
```

---

## 🚀 Step 6: Start Nora

Launch both the Discord Bot and Web Dashboard API server:

```bash
npm start
```

When initialization succeeds, you will see output like:
```text
[System] Web Dashboard listening on port 3000
[Events] Successfully registered 27 system events.
[System] Ready! Initializing Nora Mainframe as YourBot#1234
```

You can now visit `http://localhost:3000` in your web browser to manage your server settings!

---

## 🔁 Step 7: 24/7 Production Process Management (PM2)

To keep Nora running continuously in the background, install **PM2**:

```bash
# Install PM2 globally
npm install -g pm2

# Start Nora as a background service
pm2 start src/index.js --name "nora-studio"

# Save process list and enable launch on system reboot
pm2 save
pm2 startup
```

### Useful Management Commands
- View logs: `pm2 logs nora-studio`
- View status: `pm2 status`
- Restart bot: `pm2 restart nora-studio`
- Stop bot: `npm run shutdown` or `pm2 stop nora-studio`

---

## ❓ Troubleshooting & FAQs

- **Bot doesn't respond to chat messages?**
  Ensure `MESSAGE_CONTENT` intent is turned ON in the Discord Developer Portal.
- **Port 3000 already in use?**
  Change `PORT=3000` in your `.env` to another available port (e.g. `PORT=3001`).
- **Commands not updating in Discord UI?**
  Restart the bot with `npm start`. Command registries automatically sync on startup.
