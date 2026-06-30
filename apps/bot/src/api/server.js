const express = require('express');
const cors = require('cors');

const settingsRouter = require('./routes/settings');

const app = express();

// Set up strict CORS allowing only the GitHub Pages dashboard
const corsOptions = {
    origin: 'https://vaztinix.github.io',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json()); // Enable JSON body parsing

// Route mounting
// We use mergeParams in the router to capture the guildId
app.use('/api/guilds/:guildId/settings', settingsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Nora API is running.' });
});

// Function to start the API Server
const startApiServer = (port = process.env.API_PORT || 5000) => {
    app.listen(port, () => {
        console.log(`[API] Express Server listening on port ${port}`);
        console.log(`[API] CORS restricted to https://vaztinix.github.io`);
    });
};

module.exports = { startApiServer, app };
