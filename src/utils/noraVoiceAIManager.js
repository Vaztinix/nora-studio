const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus,
    VoiceConnectionStatus,
    EndBehaviorType,
    NoSubscriberBehavior,
    entersState
} = require('@discordjs/voice');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits
} = require('discord.js');
const prism = require('prism-media');
const axios = require('axios');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const geminiKeyManager = require('./geminiKeyManager');
const { getBuiltInResponse } = require('./builtInBrain');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Ensure FFMPEG_PATH is globally configured
try {
    const ffmpegPath = require('ffmpeg-static');
    if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;
} catch (_) {}

// 🔒 Restricted Server: Milo's World Only
const BETA_GUILD_ID = '1487342521133830174';
const BETA_INVITE_URL = 'https://discord.gg/3g2BCaAYDD';

// 🎬 Animated Audio Waveform & Visualizer Assets
const ANIMATED_VISUALIZER_URL = 'https://media.giphy.com/media/26AHONQJhMhRX5EzK/giphy.gif';
const SPEAKING_VISUALIZER_URL = 'https://media.giphy.com/media/xT9IgzoKnwFNmISR8I/giphy.gif';
const IDLE_VISUALIZER_URL = 'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNmNlcWdrMzhzZXk2c214d2l2dzJ0bHpybGFxNG9mZnVra3h0M21vMyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/13HgwGsXF0aiGY/giphy.gif';

/**
 * Constructs a 44-byte WAV audio buffer header around raw PCM chunks
 * @param {Buffer} pcmBuffer 
 * @param {number} sampleRate 
 * @param {number} channels 
 * @param {number} bitDepth 
 * @returns {Buffer}
 */
function createWavBuffer(pcmBuffer, sampleRate = 48000, channels = 2, bitDepth = 16) {
    const header = Buffer.alloc(44);
    const byteRate = sampleRate * channels * (bitDepth / 8);
    const blockAlign = channels * (bitDepth / 8);
    const dataLength = pcmBuffer.length;
    const fileLength = dataLength + 36;

    header.write('RIFF', 0);
    header.writeUInt32LE(fileLength, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitDepth, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataLength, 40);

    return Buffer.concat([header, pcmBuffer]);
}

/**
 * Splits text into clean conversational chunks for smooth TTS playback
 * @param {string} text 
 * @param {number} maxLength 
 * @returns {string[]}
 */
function chunkTextForTTS(text, maxLength = 250) {
    if (!text) return [];
    const clean = text
        .replace(/https?:\/\/[^\s]+/g, '')
        .replace(/[`*~_#|<>]/g, '')
        .replace(/<a?:\w+:\d+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length <= maxLength) return [clean];

    const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [clean];
    const chunks = [];
    let current = '';

    for (const s of sentences) {
        const trimmed = s.trim();
        if ((current + ' ' + trimmed).trim().length <= maxLength) {
            current = (current + ' ' + trimmed).trim();
        } else {
            if (current) chunks.push(current);
            current = trimmed;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}

/**
 * Fetches Studio-Grade Microsoft Neural MP3 audio buffer with fallback
 * @param {string} text 
 * @returns {Promise<Buffer>}
 */
async function fetchTTSAudioBuffer(text) {
    try {
        const tts = new MsEdgeTTS();
        // en-US-JennyNeural is natural, warm, fluent, and crystal clear
        await tts.setMetadata('en-US-JennyNeural', OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
        const { audioStream } = tts.toStream(text);

        return await new Promise((resolve, reject) => {
            const chunks = [];
            const timeout = setTimeout(() => reject(new Error('Neural TTS timeout')), 10000);

            audioStream.on('data', chunk => chunks.push(chunk));
            audioStream.on('end', () => {
                clearTimeout(timeout);
                resolve(Buffer.concat(chunks));
            });
            audioStream.on('error', err => {
                clearTimeout(timeout);
                reject(err);
            });
        });
    } catch (neuralErr) {
        console.warn('[NoraVoiceAI] Neural TTS fallback to secondary stream:', neuralErr.message);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en&client=tw-ob`;
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 10000
        });
        return Buffer.from(response.data);
    }
}

class NoraVoiceAIManager {
    constructor() {
        this.sessions = new Map(); // guildId -> VoiceSession
    }

    /**
     * Checks if the voice request is permitted in the given guild
     * @param {string} guildId 
     * @returns {boolean}
     */
    isGuildAllowed(guildId) {
        return guildId === BETA_GUILD_ID;
    }

    /**
     * Generates standard beta restriction embed & action row
     */
    getBetaRestrictionPayload() {
        const embed = new EmbedBuilder()
            .setTitle('✨ Nora Voice AI (STT & TTS) — Exclusive Beta')
            .setDescription(
                '🎙️ **Speech-to-Text & Real-Time Voice Synthesis** is currently in active beta testing exclusively in the **Milo\'s World** headquarters!\n\n' +
                'Join the official server to test live conversational voice AI, custom animations, and hands-free voice commands.'
            )
            .setColor(0x5865F2)
            .setImage(ANIMATED_VISUALIZER_URL)
            .setFooter({ text: 'Milo\'s World Voice AI Lab • Beta Testing Only' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('request_nora_ai_beta_invite')
                .setLabel('Request Milo\'s World Invite')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('📨'),
            new ButtonBuilder()
                .setLabel('Direct Server Link')
                .setStyle(ButtonStyle.Link)
                .setURL(BETA_INVITE_URL)
        );

        return { embeds: [embed], components: [row] };
    }

    /**
     * Joins a voice channel and initializes real-time STT & TTS pipeline
     */
    async joinVoice(voiceChannel, textChannel, initiatorMember) {
        const guildId = voiceChannel.guild.id;

        // 1. Strict Guild Beta Check
        if (!this.isGuildAllowed(guildId)) {
            return {
                success: false,
                isRestricted: true,
                payload: this.getBetaRestrictionPayload()
            };
        }

        // 2. Permission Check
        const permissions = voiceChannel.permissionsFor(voiceChannel.guild.members.me);
        if (!permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
            return {
                success: false,
                message: '❌ I lack `Connect` or `Speak` permissions for that voice channel.'
            };
        }

        // 3. Clean up existing session if active
        if (this.sessions.has(guildId)) {
            this.leaveVoice(guildId, false);
        }

        try {
            const connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guildId,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

            // Attempt to force voice state undeafen if server deafened
            try {
                const me = voiceChannel.guild.members.me;
                if (me?.voice?.serverDeaf) {
                    await me.voice.setDeaf(false).catch(() => {});
                }
                if (me?.voice?.serverMute) {
                    await me.voice.setMute(false).catch(() => {});
                }
            } catch (_) {}

            // Create Audio Player with NoSubscriberBehavior.Play to prevent autopausing
            const player = createAudioPlayer({
                behaviors: {
                    noSubscriber: NoSubscriberBehavior.Play,
                    maxMissedFrames: 50
                }
            });

            const subscription = connection.subscribe(player);
            console.log(`[NoraVoiceAI] Subscribed player to voice connection in ${voiceChannel.name}. Subscription active:`, !!subscription);

            const session = {
                guildId,
                voiceChannel,
                textChannel,
                initiatorMember,
                connection,
                player,
                subscription,
                isProcessing: false,
                isSpeaking: false,
                activeSpeakers: new Set(),
                currentAudioFile: null,
                lastActivity: Date.now(),
                visualizerMessage: null,
                conversationHistory: []
            };

            this.sessions.set(guildId, session);

            // Handle disconnection
            connection.on(VoiceConnectionStatus.Disconnected, async () => {
                try {
                    await Promise.race([
                        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                    ]);
                } catch (e) {
                    this.leaveVoice(guildId);
                }
            });

            player.on('error', (err) => {
                console.error('[NoraVoiceAI] Audio Player Error:', err.message);
                session.isSpeaking = false;
                this.cleanupCurrentAudioFile(session);
                this.updateVisualizer(session, 'idle');
            });

            player.on(AudioPlayerStatus.Idle, () => {
                session.isSpeaking = false;
                this.cleanupCurrentAudioFile(session);
                this.updateVisualizer(session, 'idle');
            });

            player.on(AudioPlayerStatus.Playing, () => {
                console.log(`[NoraVoiceAI] Player status is now PLAYING in voice channel ${voiceChannel.name}.`);
            });

            // Bind speech receiver
            this.attachReceiver(session);

            // Send initial visualizer message in text channel
            await this.sendInitialVisualizer(session);

            // Play short greeting
            await this.speak(session, `Hello ${initiatorMember.displayName}! Nora Voice AI is online and listening. You can speak to me naturally.`);

            return { success: true, session };
        } catch (error) {
            console.error('[NoraVoiceAI Join Error]:', error);
            return {
                success: false,
                message: `❌ Failed to join voice channel: ${error.message}`
            };
        }
    }

    cleanupCurrentAudioFile(session) {
        if (session && session.currentAudioFile) {
            try {
                if (fs.existsSync(session.currentAudioFile)) {
                    fs.unlinkSync(session.currentAudioFile);
                }
            } catch (_) {}
            session.currentAudioFile = null;
        }
    }

    /**
     * Attaches audio receiver to capture speech packets from speakers
     */
    attachReceiver(session) {
        const { connection } = session;
        const receiver = connection.receiver;

        receiver.speaking.on('start', (userId) => {
            // Ignore bot's own voice or if Nora is currently speaking
            if (userId === session.voiceChannel.client.user.id || session.isSpeaking || session.isProcessing) {
                return;
            }

            if (session.activeSpeakers.has(userId)) return;

            const member = session.voiceChannel.guild.members.cache.get(userId);
            if (!member || member.user.bot) return;

            session.activeSpeakers.add(userId);

            const opusStream = receiver.subscribe(userId, {
                end: {
                    behavior: EndBehaviorType.AfterSilence,
                    duration: 800 // 800ms silence marks end of utterance
                }
            });

            const decoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
            const pcmChunks = [];

            opusStream.pipe(decoder);

            decoder.on('data', (chunk) => {
                pcmChunks.push(chunk);
            });

            decoder.on('end', async () => {
                session.activeSpeakers.delete(userId);
                const pcmBuffer = Buffer.concat(pcmChunks);

                // Minimum speech threshold: at least ~0.35s of audio
                if (pcmBuffer.length < 48000 * 2 * 2 * 0.35) {
                    return;
                }

                if (session.isSpeaking || session.isProcessing) return;

                await this.processUserSpeech(session, member, pcmBuffer);
            });

            decoder.on('error', (err) => {
                session.activeSpeakers.delete(userId);
                console.error('[NoraVoiceAI] Decoder error:', err.message);
            });
        });
    }

    /**
     * Transcribes audio using Gemini Speech-to-Text and generates AI spoken reply
     */
    async processUserSpeech(session, speakerMember, pcmBuffer) {
        session.isProcessing = true;
        session.lastActivity = Date.now();

        console.log(`[NoraVoiceAI] Captured speech from ${speakerMember.displayName} (${pcmBuffer.length} bytes PCM). Transcribing...`);

        await this.updateVisualizer(session, 'thinking', {
            speaker: speakerMember,
            statusText: `⚡ Hearing voice from **${speakerMember.displayName}**... Transcribing with Gemini AI...`
        });

        try {
            const wavBuffer = createWavBuffer(pcmBuffer, 48000, 2, 16);
            const base64Audio = wavBuffer.toString('base64');

            // 1. Transcribe audio with Gemini (Auto-rotating across key pool)
            const transcription = await this.transcribeAudio(base64Audio);
            console.log(`[NoraVoiceAI] Transcription for ${speakerMember.displayName}: "${transcription}"`);

            if (!transcription || transcription.trim() === 'EMPTY_AUDIO' || transcription.trim().length < 2) {
                console.log(`[NoraVoiceAI] Empty speech or non-speech audio detected for ${speakerMember.displayName}.`);
                session.isProcessing = false;
                await this.updateVisualizer(session, 'idle');
                return;
            }

            // Check if user spoke a trigger to leave
            if (/^(leave\s*voice|leave\s*nora\s*ai|disconnect|goodbye\s*nora|bye\s*nora)$/i.test(transcription.trim())) {
                await this.speak(session, `Goodbye ${speakerMember.displayName}! Leaving the voice channel.`);
                setTimeout(() => this.leaveVoice(session.guildId), 3500);
                return;
            }

            await this.updateVisualizer(session, 'answering', {
                speaker: speakerMember,
                transcription: transcription,
                statusText: `🧠 Thinking of spoken response for **${speakerMember.displayName}**...`
            });

            // 2. Generate Spoken Response with Nora Brain
            const aiResponse = await getBuiltInResponse(transcription, {
                context: `[VOICE CHAT MODE] You are Nora, talking live through voice in channel '${session.voiceChannel.name}' with user '${speakerMember.displayName}'. Keep your response concise, conversational, natural, and expressive (1-2 sentences maximum so it sounds quick and wonderful when read out loud). Do not include formatting markdown (bold, lists, backticks) or emoji text.`,
                authorName: speakerMember.displayName,
                isPremium: true
            });

            const replyText = typeof aiResponse === 'string' ? aiResponse : (aiResponse.reply || aiResponse.text || 'I hear you loud and clear!');
            console.log(`[NoraVoiceAI] Generated spoken response: "${replyText}"`);

            // 3. Play Spoken Audio
            await this.updateVisualizer(session, 'speaking', {
                speaker: speakerMember,
                transcription: transcription,
                reply: replyText
            });

            await this.speak(session, replyText);

        } catch (error) {
            console.error('[NoraVoiceAI Speech Processing Error]:', error);
            session.isProcessing = false;
            await this.updateVisualizer(session, 'idle');
        } finally {
            session.isProcessing = false;
        }
    }

    /**
     * Transcribes base64 audio buffer using Gemini API with auto-key cascade
     * @param {string} base64Audio 
     * @returns {Promise<string>}
     */
    async transcribeAudio(base64Audio) {
        const availableKeys = geminiKeyManager.getRotatedAvailableKeys();
        if (availableKeys.length === 0) {
            console.warn('[NoraVoiceAI] All Gemini keys currently on quota cooldown.');
            return '';
        }

        // Prioritize ultra-fast high-availability flash models for transcription
        const modelsToTry = ['gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest'];

        for (const key of availableKeys) {
            const genAI = new GoogleGenerativeAI(key);

            for (const modelName of modelsToTry) {
                try {
                    const model = genAI.getGenerativeModel({
                        model: modelName,
                        generationConfig: {
                            temperature: 0.1,
                            maxOutputTokens: 250
                        }
                    });

                    const result = await model.generateContent([
                        {
                            inlineData: {
                                mimeType: 'audio/wav',
                                data: base64Audio
                            }
                        },
                        'Transcribe the exact words spoken by the human voice in this audio. If there is no clear speech, only background noise or silence, output EMPTY_AUDIO. Output ONLY the transcription.'
                    ]);

                    const raw = result.response.text().trim();
                    if (raw && raw.length > 0) {
                        geminiKeyManager.reportSuccess(key);
                        return raw.replace(/^["']|["']$/g, '').trim();
                    }
                } catch (err) {
                    if (err.message && (err.message.includes('429') || err.message.includes('Quota') || err.message.includes('RESOURCE_EXHAUSTED'))) {
                        geminiKeyManager.handleQuotaError(key, err);
                        break; // cascade to next key
                    }
                }
            }
        }
        return '';
    }

    /**
     * Synthesizes and plays spoken text in the voice channel
     */
    async speak(session, text) {
        if (!session || !session.player) return;

        session.isSpeaking = true;
        this.cleanupCurrentAudioFile(session);

        try {
            const chunks = chunkTextForTTS(text, 180);
            if (chunks.length === 0) {
                session.isSpeaking = false;
                this.updateVisualizer(session, 'idle');
                return;
            }

            // Fetch and concatenate all TTS chunks
            const audioBuffers = [];
            for (const c of chunks) {
                const b = await fetchTTSAudioBuffer(c);
                if (b && b.length > 0) audioBuffers.push(b);
            }

            if (audioBuffers.length === 0) {
                session.isSpeaking = false;
                this.updateVisualizer(session, 'idle');
                return;
            }

            const totalBuffer = Buffer.concat(audioBuffers);

            // Write to a temporary file for 100% reliable direct Discord.js Voice playback
            const tmpFile = path.join(os.tmpdir(), `nora_voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`);
            fs.writeFileSync(tmpFile, totalBuffer);
            session.currentAudioFile = tmpFile;

            const resource = createAudioResource(tmpFile);
            session.player.play(resource);
            console.log(`[NoraVoiceAI] Dispatched audio resource (${totalBuffer.length} bytes) to player for: "${text.substring(0, 45)}..."`);

        } catch (error) {
            console.error('[NoraVoiceAI Speak Error]:', error);
            session.isSpeaking = false;
            this.cleanupCurrentAudioFile(session);
            this.updateVisualizer(session, 'idle');
        }
    }

    /**
     * Sends the persistent interactive visualizer card in the text channel
     */
    async sendInitialVisualizer(session) {
        if (!session.textChannel) return;

        const embed = new EmbedBuilder()
            .setTitle('🎙️ Nora Voice AI — Live Audio Session')
            .setDescription(
                `🟢 **Voice Channel:** \`${session.voiceChannel.name}\`\n` +
                `✨ **Status:** Connected & Listening\n` +
                `🗣️ **Active Engine:** Gemini AI Multi-Key Speech Pipeline\n\n` +
                `*Speak naturally in the voice channel, or type \`LeaveNoraAI\` / click below to end the session.*`
            )
            .setColor(0x00F0FF)
            .setImage(ANIMATED_VISUALIZER_URL)
            .setFooter({ text: 'Milo\'s World Voice AI • Real-Time Speech-to-Text & Neural Audio' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('voice_ai_leave')
                .setLabel('Disconnect Nora')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('🛑'),
            new ButtonBuilder()
                .setCustomId('voice_ai_quota')
                .setLabel('Engine Quota')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📊')
        );

        try {
            const msg = await session.textChannel.send({ embeds: [embed], components: [row] });
            session.visualizerMessage = msg;
        } catch (e) {
            console.error('[NoraVoiceAI] Failed to send visualizer message:', e.message);
        }
    }

    /**
     * Updates visualizer card with live animation, transcription, and speech
     */
    async updateVisualizer(session, state = 'idle', data = {}) {
        if (!session.visualizerMessage) return;

        try {
            const embed = new EmbedBuilder()
                .setTitle('🎙️ Nora Voice AI — Live Audio Session')
                .setColor(state === 'speaking' ? 0x00FF88 : (state === 'thinking' ? 0xFFBB00 : (state === 'answering' ? 0x9B59B6 : 0x00F0FF)))
                .setFooter({ text: 'Milo\'s World Voice AI • Real-Time Speech-to-Text & Neural Audio' })
                .setTimestamp();

            if (state === 'thinking') {
                embed.setDescription(
                    `⚡ **Status:** Hearing voice...\n` +
                    `👤 **Speaker:** ${data.speaker ? `<@${data.speaker.id}>` : 'Unknown'}\n` +
                    `🔄 **Processing:** Transcribing voice with Gemini...`
                );
                embed.setImage(ANIMATED_VISUALIZER_URL);
            } else if (state === 'answering') {
                embed.setDescription(
                    `⚡ **Status:** Formulating Response\n` +
                    `👤 **Speaker:** ${data.speaker ? `<@${data.speaker.id}>` : 'Unknown'}\n` +
                    `📝 **Heard:** *"${data.transcription}"*\n` +
                    `🧠 **Brain:** Formulating spoken response...`
                );
                embed.setImage(ANIMATED_VISUALIZER_URL);
            } else if (state === 'speaking') {
                embed.setDescription(
                    `🔊 **Status:** Nora is speaking live in VC!\n` +
                    `👤 **Speaker:** ${data.speaker ? `<@${data.speaker.id}>` : 'User'}\n` +
                    `📝 **Heard:** *"${data.transcription || '...'}"*\n` +
                    `🎙️ **Nora Replied:** "${data.reply || '...'}"`
                );
                embed.setImage(SPEAKING_VISUALIZER_URL);
            } else {
                embed.setDescription(
                    `🟢 **Voice Channel:** \`${session.voiceChannel.name}\`\n` +
                    `✨ **Status:** Ready & Listening for speech...\n` +
                    `*Speak into your microphone anytime to ask Nora questions or chat!*`
                );
                embed.setImage(IDLE_VISUALIZER_URL);
            }

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('voice_ai_leave')
                    .setLabel('Disconnect Nora')
                    .setStyle(ButtonStyle.Danger)
                    .setEmoji('🛑'),
                new ButtonBuilder()
                    .setCustomId('voice_ai_quota')
                    .setLabel('Engine Quota')
                    .setStyle(ButtonStyle.Secondary)
                    .setEmoji('📊')
            );

            await session.visualizerMessage.edit({ embeds: [embed], components: [row] });
        } catch (e) {
            // Ignore edit rate limits or deleted messages
        }
    }

    /**
     * Leaves the voice channel and cleanly tears down audio session
     */
    leaveVoice(guildId, notify = true) {
        const session = this.sessions.get(guildId);
        if (!session) return false;

        try {
            this.cleanupCurrentAudioFile(session);
            if (session.player) {
                session.player.stop(true);
            }
            if (session.connection) {
                session.connection.destroy();
            }
            if (notify && session.textChannel) {
                const leaveEmbed = new EmbedBuilder()
                    .setTitle('👋 Nora Voice AI Disconnected')
                    .setDescription(`Disconnected from \`${session.voiceChannel.name}\`. Thank you for testing Nora Voice AI in Milo's World!`)
                    .setColor(0xED4245);
                session.textChannel.send({ embeds: [leaveEmbed] }).catch(() => {});
            }
        } catch (e) {
            console.error('[NoraVoiceAI Leave Error]:', e.message);
        } finally {
            this.sessions.delete(guildId);
        }
        return true;
    }

    /**
     * Gets active session for guild
     */
    getSession(guildId) {
        return this.sessions.get(guildId);
    }
}

module.exports = new NoraVoiceAIManager();
