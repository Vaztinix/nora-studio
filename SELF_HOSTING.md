# 🚀 Nora Studio — Production Self-Hosting Guide

This comprehensive guide walks you through installing, configuring, deploying, and maintaining your own self-hosted instance of **Nora Bot** and the **Nora Studio Web Dashboard** with 100% data custody.

---

## 📋 System Requirements

| Specification | Minimum Requirement | Recommended Production |
| :--- | :--- | :--- |
| **Operating System** | Windows 10/11, Ubuntu 20.04+, Debian 11+, macOS | Ubuntu 22.04 LTS / Debian 12 |
| **Node.js** | `v18.0.0` or higher (`node -v`) | `v20.x LTS` or higher |
| **Memory (RAM)** | 1.5 GB free RAM | 4 GB+ RAM |
| **Disk Space** | 2 GB free disk space | 10 GB+ SSD |
| **Network** | Outbound HTTPS (port 443) | Static IP or Cloudflare Tunnel |

---

## 🛠️ Step 1: Clone the Codebase

Open a terminal or PowerShell and clone the official repository:

```bash
git clone https://github.com/Vaztinix/nora-studio.git
cd nora-studio
```

---

## 📦 Step 2: Install Node.js Dependencies

Install all dependencies using npm:

```bash
npm install
```

> [!TIP]
> **Native Modules (Sharp & SQLite3):**
> Nora utilizes `sharp` for fast image manipulation (generating CAPTCHAs, rank cards, and guild telemetry) and `sqlite3` for local storage. If you are on Linux, ensure build essentials are installed:
> ```bash
> # Ubuntu / Debian:
> sudo apt-get update && sudo apt-get install -y build-essential python3
> ```

---

## ⚙️ Step 3: Configure Environment Variables (`.env`)

1. Generate your `.env` file from the provided template:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` in a text editor (e.g. `nano .env` or VS Code) and configure your variables:

```env
# ========================================================
# 🌐 WEB DASHBOARD & API SERVER
# ========================================================
PORT=3000
API_BASE_URL=http://localhost:3000

# ========================================================
# 🤖 DISCORD BOT CREDENTIALS (REQUIRED)
# ========================================================
TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_application_id_here
CLIENT_SECRET=your_discord_oauth_secret_here

# ========================================================
# 🧠 GOOGLE GEMINI AI (GEMINI 3.8 FLASH ENGINE)
# ========================================================
# Primary Gemini API Key (from https://aistudio.google.com/)
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Multi-Key Quota Balancing (Load-balance across projects)
# Nora automatically rotates keys and manages cooldowns when daily limits hit:
GEMINI_API_KEY_1=your_first_backup_key
GEMINI_API_KEY_2=your_second_backup_key
# Or as comma-separated:
# GEMINI_API_KEYS=key1,key2,key3

# Optional: OpenAI Fallback (gpt-4o-mini)
OPENAI_API_KEY=your_openai_api_key_here

# ========================================================
# 🎮 ROBLOX VERIFICATION (OPTIONAL)
# ========================================================
# Required only if you enable Roblox verification & group rank roles:
ROBLOX_COOKIE=your_roblox_cookie_here

# ========================================================
# 📊 TOP.GG STATS POSTING (OPTIONAL)
# ========================================================
TOPGG_TOKEN=your_topgg_token_here
```

---

## 🔑 Step 4: Configure the Discord Developer Portal

For Nora's AutoMod, Anti-Raid, Leveling, and Chat features to function, you must enable Discord Gateway Intents:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Select your Application (or create a new one).
3. Navigate to the **Bot** tab on the left sidebar.
4. Under **Privileged Gateway Intents**, turn **ON** all three switches:
   - ✅ **Presence Intent** (`GUILD_PRESENCES`)
   - ✅ **Server Members Intent** (`GUILD_MEMBERS`)
   - ✅ **Message Content Intent** (`MESSAGE_CONTENT`)
5. Click **Save Changes**.

### 🔗 Invite Nora to Your Server
Generate an invite link by navigating to **OAuth2** -> **URL Generator**:
- **Scopes**: `bot`, `applications.commands`
- **Permissions**: Administrator (or standard permission integer `1102464543799`)
- Invite URL format:
  ```
  https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=1102464543799&scope=bot+applications.commands
  ```

---

## 🏗️ Step 5: Build Web Dashboard Assets

Nora includes a standalone, high-performance web dashboard. Compile the front-end distribution files by running:

```bash
npm run build
```

This command runs Nora's **Build Safety Filter** (`scripts/safety_filter.js`), ensuring zero API keys, webhooks, or tokens are leaked into the `/dist` directory.

---

## 🚀 Step 6: Initial Launch & Verification

Start Nora to initialize the local SQLite database (`database.sqlite`) and register slash commands:

```bash
npm start
```

Upon successful startup, the console will output:
```text
[System] Web Dashboard listening on port 3000
[Database] SQLite database connection established with WAL mode.
[System] Ready! Initializing Nora Mainframe as YourBot#1234
[Invite Tracker] Always-on invite tracker initialized.
```

Open `http://localhost:3000` in your browser to verify the Web Dashboard is live!

---

## 🔁 Step 7: 24/7 Production Deployment

### Option A: PM2 Process Manager (Recommended for Linux/VPS)

**PM2** keeps Nora online continuously, automatically restarting the bot if the server reboots or encounters an error.

```bash
# 1. Install PM2 globally
sudo npm install -g pm2

# 2. Start Nora under PM2 with 4GB memory allocation
pm2 start src/index.js --name "nora-bot" --node-args="--max-old-space-size=4096"

# 3. Save process configuration and enable startup on system boot
pm2 save
pm2 startup
```

#### Essential PM2 Commands:
- View live logs: `pm2 logs nora-bot`
- Check status: `pm2 status`
- Restart Nora: `pm2 restart nora-bot`
- Stop Nora: `pm2 stop nora-bot`

---

### Option B: Systemd Service (Linux Production)

Create a system service at `/etc/systemd/system/nora.service`:

```ini
[Unit]
Description=Nora Studio Discord Bot & Dashboard
After=network.target

[Service]
Type=simple
User=your_linux_username
WorkingDirectory=/home/your_linux_username/nora-studio
ExecStart=/usr/bin/node --max-old-space-size=4096 src/index.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=nora-bot
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl enable nora
sudo systemctl start nora
sudo systemctl status nora
```

---

### Option C: Docker Containerization

If you prefer containerized deployments, create a `Dockerfile`:

```dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

# Install native compilation tools
RUN apt-get update && apt-get install -y python3 build-essential git && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["node", "--max-old-space-size=4096", "src/index.js"]
```

Build and run with persistent storage for your SQLite database:
```bash
# Build Docker image
docker build -t nora-studio .

# Run container with database volume
docker run -d \
  --name nora-studio \
  --restart unless-stopped \
  -p 3000:3000 \
  -v nora_data:/app/src/database \
  --env-file .env \
  nora-studio
```

---

## 🌐 Step 8: Expose Web Dashboard with SSL (Cloudflare Tunnel)

To access your Web Dashboard securely over HTTPS without opening inbound firewall ports, use **Cloudflare Tunnel** (the exact method used by `vaztinix.dev`):

1. Install `cloudflared`:
   - **Ubuntu/Debian**:
     ```bash
     curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
     sudo dpkg -i cloudflared.deb
     ```
   - **Windows**: Download the binary from Cloudflare Releases.

2. Authenticate and create a tunnel:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create nora-tunnel
   ```

3. Route traffic to your local dashboard:
   ```bash
   cloudflared tunnel route dns nora-tunnel nora.yourdomain.com
   ```

4. Create configuration file `~/.cloudflared/config.yml`:
   ```yaml
   tunnel: YOUR_TUNNEL_UUID
   credentials-file: /home/username/.cloudflared/YOUR_TUNNEL_UUID.json

   ingress:
     - hostname: nora.yourdomain.com
       service: http://localhost:3000
     - service: http_status:404
   ```

5. Run tunnel as a system service:
   ```bash
   sudo cloudflared service install
   sudo systemctl start cloudflared
   ```

Your dashboard is now accessible at `https://nora.yourdomain.com` with free, automated SSL encryption!

---

## 🧹 Step 9: Maintenance & Updates

### Updating Nora to the Latest Version
Pull new code while preserving your local database and settings:

```bash
# 1. Stop the current process
npm run shutdown

# 2. Pull updates from origin
git pull origin main

# 3. Update dependencies & re-bundle dashboard
npm install
npm run build

# 4. Restart Nora
npm start
# (Or 'pm2 restart nora-bot' if using PM2)
```

### Clean Graceful Shutdown
To cleanly terminate Nora and all associated tunnel processes:
```bash
npm run shutdown
```

### Database Backup
Your entire guild configuration, leveling XP, AFK state, and custom settings live in:
- `src/database/database.sqlite` (or `database.sqlite`)

To back up your data:
```bash
cp src/database/database.sqlite "Nora Backups/backup_$(date +%F).sqlite"
```

---

## ❓ Troubleshooting & FAQs

### 1. Bot doesn't respond to chat messages or `n!` prefix commands
- **Cause:** `MESSAGE_CONTENT` intent is disabled.
- **Fix:** Go to [Discord Developer Portal](https://discord.com/developers/applications) -> Your Bot -> **Bot** tab -> Check **Message Content Intent** -> Save.

### 2. Google Gemini returns `404 Not Found`
- **Cause:** Deprecated model names (e.g. `gemini-2.5-flash` or `gemini-1.5-flash`).
- **Fix:** Nora is updated for **Gemini 3.8 Flash** (`gemini-3.8-flash`). Ensure your `.env` contains a valid key from [Google AI Studio](https://aistudio.google.com/).

### 3. Port 3000 is already in use
- **Fix:** Change `PORT=3000` in your `.env` to another port (e.g. `PORT=3005`) and update `API_BASE_URL=http://localhost:3005`.

### 4. Slash commands don't show up in Discord
- **Explanation:** When Nora restarts, `ready.js` syncs commands globally. Discord's client cache may take up to 60 seconds to propagate globally. Restart your Discord client (`Ctrl + R`) to force a fresh UI sync.

---

<div align="center">

**Nora Studio** • *Privacy-First Discord Engineering*  
[Website](https://vaztinix.dev) • [Discord Support](https://discord.gg/m9WPYV287q) • [GitHub](https://github.com/Vaztinix/nora-studio)

</div>
