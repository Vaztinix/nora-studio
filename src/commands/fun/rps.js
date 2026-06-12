const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const { handleError, handleSuccess } = require('../../utils/embeds');
const UserLevel = require('../../database/models/UserLevel');
const GuildSettings = require('../../database/models/GuildSettings');
const UserPrefs = require('../../database/models/UserPrefs');
const NoraLeveling = require('../../utils/noraLeveling');
const I18n = require('../../utils/i18n');

module.exports = {
    category: 'fun',
    data: new SlashCommandBuilder()
        .setName('rps')
        .setDescription('Play Rock, Paper, Scissors against Nora or another member!')
        .addUserOption(option => 
            option.setName('opponent')
            .setDescription('Select a member to challenge (leave blank to play against Nora)')
            .setRequired(false)
        )
        .addIntegerOption(option =>
            option.setName('bet')
            .setDescription('Amount of XP to bet (optional, min 100 XP, max 3,500 XP)')
            .setMinValue(100)
            .setMaxValue(3500)
            .setRequired(false)
        )
        .setContexts(0, 1, 2)
        .setIntegrationTypes(0, 1),

    async execute(interaction, settings) {
        const opponent = interaction.options.getUser('opponent') || interaction.client.user;
        const bet = interaction.options.getInteger('bet') || 0;
        
        // Fetch preferences for localization
        const challengerPrefs = await UserPrefs.findOne({ where: { userId: interaction.user.id } });
        const lang = I18n.getLanguage(settings, challengerPrefs, interaction);

        // Verify if feature is enabled in guild
        if (interaction.guildId && settings && settings.rpsGameEnabled === false) {
            return handleError(interaction, I18n.t(lang, 'feature_disabled'), 'The Rock, Paper, Scissors game is currently disabled on this server.');
        }

        // Fetch server game rewards config
        let rpsReward = 50;
        if (settings && settings.rpsGameXpReward) {
            rpsReward = settings.rpsGameXpReward;
        }

        // Get levels to verify XP for betting
        const challengerRecord = await NoraLeveling.getOrInitializeUser(interaction.user.id, interaction.guildId || 'DM');
        if (!challengerRecord) {
            return handleError(interaction, I18n.t(lang, 'database_error'), I18n.t(lang, 'db_init_fail'));
        }

        if (bet > 0) {
            if (challengerRecord.xp < bet && challengerRecord.level === 0) {
                return handleError(
                    interaction, 
                    I18n.t(lang, 'insufficient_xp'), 
                    I18n.t(lang, 'insufficient_xp_desc', { xp: challengerRecord.xp })
                );
            }
        }

        const isVSBot = opponent.id === interaction.client.user.id;

        if (!isVSBot) {
            if (opponent.id === interaction.user.id) {
                return handleError(interaction, I18n.t(lang, 'challenge_error'), I18n.t(lang, 'challenge_self'));
            }
            if (opponent.bot) {
                return handleError(interaction, I18n.t(lang, 'challenge_error'), I18n.t(lang, 'challenge_bot'));
            }

            const opponentRecord = await NoraLeveling.getOrInitializeUser(opponent.id, interaction.guildId || 'DM');
            if (!opponentRecord) {
                return handleError(interaction, I18n.t(lang, 'database_error'), I18n.t(lang, 'db_init_fail'));
            }

            if (bet > 0 && opponentRecord.xp < bet && opponentRecord.level === 0) {
                return handleError(
                    interaction, 
                    I18n.t(lang, 'insufficient_xp'), 
                    I18n.t(lang, 'insufficient_xp_opponent', { opponent: opponent.id, xp: opponentRecord.xp, bet })
                );
            }
        }

        // Options details
        const emojis = { rock: '🪨', paper: '📄', scissors: '✂️' };
        const winRelations = {
            rock: 'scissors',
            paper: 'rock',
            scissors: 'paper'
        };

        const translateChoice = (choiceKey) => {
            return I18n.t(lang, `rps_choice_${choiceKey}`);
        };

        const embed = new EmbedBuilder()
            .setAuthor({ name: I18n.t(lang, 'rps_title'), iconURL: interaction.client.user.displayAvatarURL() })
            .setColor('#aeefff')
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rps_rock').setLabel(translateChoice('rock')).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rps_paper').setLabel(translateChoice('paper')).setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('rps_scissors').setLabel(translateChoice('scissors')).setStyle(ButtonStyle.Secondary)
        );

        if (isVSBot) {
            const betInfo = bet > 0 
                ? I18n.t(lang, 'rps_bet_info', { bet }) 
                : I18n.t(lang, 'rps_prize_info', { reward: rpsReward });

            embed.setTitle(I18n.t(lang, 'rps_challenge_title'))
                .setDescription(I18n.t(lang, 'rps_challenge_desc', { bet_info: betInfo }));

            const response = await interaction.reply({
                embeds: [embed],
                components: [row],
                fetchReply: true,
                ephemeral: true
            });

            const filter = i => i.user.id === interaction.user.id && i.customId.startsWith('rps_');
            const collector = response.createMessageComponentCollector({ filter, componentType: ComponentType.Button, time: 30000 });

            collector.on('collect', async i => {
                await i.deferUpdate();
                
                const userChoice = i.customId.split('_')[1];
                const botChoice = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
                
                let resultText = '';
                let finalColor = 0xaeefff;
                let xpChange = 0;

                if (userChoice === botChoice) {
                    resultText = I18n.t(lang, 'rps_draw_desc_bot', { emoji: emojis[userChoice], choice: translateChoice(userChoice).toUpperCase() });
                    finalColor = 0xffa500;
                } else if (winRelations[userChoice] === botChoice) {
                    xpChange = bet > 0 ? bet : rpsReward;
                    resultText = I18n.t(lang, 'rps_win_desc_bot', { 
                        win_emoji: emojis[userChoice], 
                        win_choice: translateChoice(userChoice).toUpperCase(), 
                        lose_emoji: emojis[botChoice], 
                        lose_choice: translateChoice(botChoice).toUpperCase(), 
                        xp: xpChange 
                    });
                    finalColor = 0x2ecc71;
                    
                    challengerRecord.xp += xpChange;
                    await challengerRecord.save();
                    await NoraLeveling.addExperience(challengerRecord, 0); 
                } else {
                    xpChange = bet > 0 ? -bet : 0;
                    const deduction = bet > 0 ? I18n.t(lang, 'rps_xp_deducted', { bet }) : '';
                    resultText = I18n.t(lang, 'rps_lose_desc_bot', { 
                        win_emoji: emojis[botChoice], 
                        win_choice: translateChoice(botChoice).toUpperCase(), 
                        lose_emoji: emojis[userChoice], 
                        lose_choice: translateChoice(userChoice).toUpperCase(), 
                        deduction 
                    });
                    finalColor = 0xe74c3c;

                    if (bet > 0) {
                        challengerRecord.xp = Math.max(0, challengerRecord.xp - bet);
                        await challengerRecord.save();
                    }
                }

                const resultEmbed = new EmbedBuilder()
                    .setAuthor({ name: I18n.t(lang, 'rps_title'), iconURL: interaction.client.user.displayAvatarURL() })
                    .setTitle('🎮 Game Complete')
                    .setDescription(resultText)
                    .setColor(finalColor)
                    .addFields(
                        { name: I18n.t(lang, 'rps_your_move'), value: `${emojis[userChoice]} ${translateChoice(userChoice).toUpperCase()}`, inline: true },
                        { name: I18n.t(lang, 'rps_bot_move'), value: `${emojis[botChoice]} ${translateChoice(botChoice).toUpperCase()}`, inline: true }
                    )
                    .setFooter({ text: `Played by ${interaction.user.tag}`, iconURL: interaction.user.displayAvatarURL() })
                    .setTimestamp();

                await interaction.editReply({ embeds: [resultEmbed], components: [] });
                collector.stop();
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'time' && collected.size === 0) {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle(I18n.t(lang, 'expired_title'))
                        .setDescription(I18n.t(lang, 'expired_desc'))
                        .setColor(0x7f8c8d);
                    await interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
                }
            });

        } else {
            // PVP Game
            const betInfo = bet > 0 ? I18n.t(lang, 'rps_bet_info', { bet }) : '';

            embed.setTitle(I18n.t(lang, 'rps_pvp_title'))
                .setDescription(I18n.t(lang, 'rps_pvp_desc', { challenger: interaction.user.id, opponent: opponent.id, bet_info: betInfo }));

            const response = await interaction.reply({
                embeds: [embed],
                components: [row],
                fetchReply: true
            });

            let challengerChoice = null;
            let opponentChoice = null;

            const filter = i => [interaction.user.id, opponent.id].includes(i.user.id) && i.customId.startsWith('rps_');
            const collector = response.createMessageComponentCollector({ filter, componentType: ComponentType.Button, time: 60000 });

            collector.on('collect', async i => {
                const isChallenger = i.user.id === interaction.user.id;
                const choice = i.customId.split('_')[1];

                const voterPrefs = await UserPrefs.findOne({ where: { userId: i.user.id } });
                const voterLang = I18n.getLanguage(settings, voterPrefs, i);

                if (isChallenger) {
                    if (challengerChoice) {
                        return i.reply({ content: I18n.t(voterLang, 'rps_already_chosen'), flags: 64 });
                    }
                    challengerChoice = choice;
                    await i.reply({ content: I18n.t(voterLang, 'rps_choice_recorded', { emoji: emojis[choice], choice: translateChoice(choice).toUpperCase(), waiting_for: opponent.username }), flags: 64 });
                } else {
                    if (opponentChoice) {
                        return i.reply({ content: I18n.t(voterLang, 'rps_already_chosen'), flags: 64 });
                    }
                    opponentChoice = choice;
                    await i.reply({ content: I18n.t(voterLang, 'rps_choice_recorded', { emoji: emojis[choice], choice: translateChoice(choice).toUpperCase(), waiting_for: interaction.user.username }), flags: 64 });
                }

                // If both players have chosen, determine winner!
                if (challengerChoice && opponentChoice) {
                    collector.stop('complete');
                }
            });

            collector.on('end', async (collected, reason) => {
                if (reason === 'complete') {
                    const challengerRecord = await NoraLeveling.getOrInitializeUser(interaction.user.id, interaction.guildId || 'DM');
                    const opponentRecord = await NoraLeveling.getOrInitializeUser(opponent.id, interaction.guildId || 'DM');

                    let resultTitle = '';
                    let resultText = '';
                    let finalColor = 0xaeefff;

                    if (challengerChoice === opponentChoice) {
                        resultTitle = I18n.t(lang, 'rps_draw_title');
                        resultText = I18n.t(lang, 'rps_draw_desc', { emoji: emojis[challengerChoice], choice: translateChoice(challengerChoice).toUpperCase() });
                        finalColor = 0xffa500;
                    } else if (winRelations[challengerChoice] === opponentChoice) {
                        resultTitle = I18n.t(lang, 'rps_win_title', { winner: interaction.user.username });
                        resultText = I18n.t(lang, 'rps_win_desc', { 
                            winner_id: interaction.user.id, 
                            win_emoji: emojis[challengerChoice], 
                            win_choice: translateChoice(challengerChoice).toUpperCase(), 
                            loser_id: opponent.id, 
                            lose_emoji: emojis[opponentChoice], 
                            lose_choice: translateChoice(opponentChoice).toUpperCase() 
                        });
                        finalColor = 0x2ecc71;

                        if (bet > 0) {
                            resultText += I18n.t(lang, 'rps_xp_transferred', { bet, winner_id: interaction.user.id, loser_id: opponent.id });
                            
                            challengerRecord.xp += bet;
                            opponentRecord.xp = Math.max(0, opponentRecord.xp - bet);
                            await challengerRecord.save();
                            await opponentRecord.save();
                            
                            await NoraLeveling.addExperience(challengerRecord, 0);
                        } else {
                            resultText += I18n.t(lang, 'rps_xp_rewarded', { reward: rpsReward, winner_id: interaction.user.id });
                            challengerRecord.xp += rpsReward;
                            await challengerRecord.save();
                            await NoraLeveling.addExperience(challengerRecord, 0);
                        }
                    } else {
                        resultTitle = I18n.t(lang, 'rps_win_title', { winner: opponent.username });
                        resultText = I18n.t(lang, 'rps_win_desc', { 
                            winner_id: opponent.id, 
                            win_emoji: emojis[opponentChoice], 
                            win_choice: translateChoice(opponentChoice).toUpperCase(), 
                            loser_id: interaction.user.id, 
                            lose_emoji: emojis[challengerChoice], 
                            lose_choice: translateChoice(challengerChoice).toUpperCase() 
                        });
                        finalColor = 0x2ecc71;

                        if (bet > 0) {
                            resultText += I18n.t(lang, 'rps_xp_transferred', { bet, winner_id: opponent.id, loser_id: interaction.user.id });
                            
                            opponentRecord.xp += bet;
                            challengerRecord.xp = Math.max(0, challengerRecord.xp - bet);
                            await challengerRecord.save();
                            await opponentRecord.save();
                            
                            await NoraLeveling.addExperience(opponentRecord, 0);
                        } else {
                            resultText += I18n.t(lang, 'rps_xp_rewarded', { reward: rpsReward, winner_id: opponent.id });
                            opponentRecord.xp += rpsReward;
                            await opponentRecord.save();
                            await NoraLeveling.addExperience(opponentRecord, 0);
                        }
                    }

                    const finalEmbed = new EmbedBuilder()
                        .setAuthor({ name: I18n.t(lang, 'rps_title'), iconURL: interaction.client.user.displayAvatarURL() })
                        .setTitle(resultTitle)
                        .setDescription(resultText)
                        .setColor(finalColor)
                        .addFields(
                            { name: `${interaction.user.username}`, value: `${emojis[challengerChoice]} ${translateChoice(challengerChoice).toUpperCase()}`, inline: true },
                            { name: `${opponent.username}`, value: `${emojis[opponentChoice]} ${translateChoice(opponentChoice).toUpperCase()}`, inline: true }
                        )
                        .setTimestamp();

                    await interaction.editReply({ embeds: [finalEmbed], components: [] }).catch(() => {});
                } else {
                    const timeoutEmbed = new EmbedBuilder()
                        .setTitle(I18n.t(lang, 'cancelled_title'))
                        .setDescription(I18n.t(lang, 'cancelled_desc'))
                        .setColor(0x7f8c8d);
                    await interaction.editReply({ embeds: [timeoutEmbed], components: [] }).catch(() => {});
                }
            });
        }
    }
};
