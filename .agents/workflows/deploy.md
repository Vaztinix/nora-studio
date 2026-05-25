---
description: How to push code changes to the live Nora Assistant
---

# Nora System Deployment Workflow

Follow these steps to physically apply any code changes (JS, JSON, or SQL) to Nora's live instance.

### 1. Save Your Files
Ensure all your modified files in the `src/` directory are saved. Nora only reads what is physically written to the disk.

### 2. System Restart (The Core Refresh)
Nora does not "hot-reload" code by default. You must restart the Node.js process to clear the memory cache and load your new logic. **Crucially, ensure only ONE instance of Nora is running at a time.**

**Force-Kill and Restart (Recommended):**
// turbo
Use this to physically terminate all ghost nodes and restart a single clean instance:
```powershell
npm run shutdown; npm start
```

**Emergency Shutdown:**
// turbo
If you need to take Nora offline immediately without restarting:
```powershell
npm run shutdown
```

**Standard Restart:**
```powershell
# Stop the current process (Ctrl + C in the terminal)
# Then run:
npm start
```

### 3. Command Registry Sync
If you changed a command's "Data" (like its name, description, or options), you may need to force Discord to update its UI.

**Automated Sync:**
Normally, Nora's `ready.js` event handles this on every startup. Watch for these logs:
- `[System Sync] Global command cache physically cleared.`
- `[System Sync] Synchronized Node: [ID]`

### 4. Verification Pass
Once the terminal shows `[System] Ready!`, go to Discord and test your change:
- Use the `/info` command to verify your new "Nora Studio Group" and "System Core" branding.

> [!TIP]
> **Pro-Dev Tip:** If your changes aren't showing up in Discord after a restart, wait 60 seconds. Discord's global command cache can sometimes have a slight propagation delay!
