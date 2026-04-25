import { Client, Events, GatewayIntentBits } from "discord.js";
import { type BotConfig, validateConfig } from "./types/BotConfig";
import { LogLevel, logMessage } from "./utils/LogFormatter";
import { createSessionRebuildFinalMessage, getCurrentState, REBUILD_STATE_HEADER, reconstructSessionStateFromFinalMessage, SessionState, setCurrentState } from "./persistence/SessionPersistence";

const currentTime = () => new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });

export const initializeBot = async (config: BotConfig): Promise<void> => {
    const startUpTime = Date.now();
    validateConfig(config);

    const context = {
        isInit: false
    };

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });
    const logConfig = { level: LogLevel.INFO, sessionId: config.initId, targetChannel: { client, id: config.SYSTEM_TEXT_CHANNEL_ID }};

    client.once(Events.ClientReady, async (readyClient) => {
        context.isInit = true;
        
        const systemChannel = await client.channels.fetch(config.SYSTEM_TEXT_CHANNEL_ID);

        if (systemChannel && systemChannel.isTextBased()) {
            const systemMessagesCollection = await systemChannel.messages.fetch({
                limit: 25,
            });
            const relevantPersistenceMessages = [...systemMessagesCollection.values()].filter(message => {
                const isRelevantAuthor = message.author.bot
                    && message.author.id === config.DISCORD_BOT_ID ;
                if (!isRelevantAuthor) {
                    return false;
                }
                const lines = message.content.split('\n');
                if (lines.length < 2) {
                    return false;
                }
                return lines[lines.length - 2] === REBUILD_STATE_HEADER;
            }).map(message => {
                return {
                    createdTimestamp: message.createdTimestamp,
                    content: message.content
                };
            }).sort((a, b) => {
                return b.createdTimestamp - a.createdTimestamp;
            });

            if (relevantPersistenceMessages.length > 0) {
                const mostRecentMessage = relevantPersistenceMessages[0];
                const persistedState = await reconstructSessionStateFromFinalMessage(
                    mostRecentMessage.content
                );
                await setCurrentState(persistedState);
            }
        }

        const readyTime = Date.now();
        const timeTook = readyTime - startUpTime;

        const activationMessage = `ravebot is ready @ ${currentTime()}. Logged in as ${readyClient.user.tag} and took ${timeTook} ms. :wave:`;
        const currentState = await getCurrentState();
        const finalActivationMessage = [
            activationMessage,
            ...(currentState ? [
                '',
                '`RECONSTRUCTED IN-MEMORY STATE FROM LAST KNOWN SHUTDOWN:`',
                `\`${JSON.stringify(currentState)}\``
            ] : [])
        ].join('\n');

        if (currentState) {
            await logMessage(
                logConfig,
                finalActivationMessage
            );
            await setCurrentState({
                ...currentState,
                generation: currentState.generation + 1
            });
        } else {
            await setCurrentState({
                sessionId: config.initId,
                generation: 0
            });
        }
    });

    const shutdown = async (signal: string) => {
        if (!context.isInit){
            console.log('Abort shutdown handler due to incomplete initialization');
            process.exit(0);
        }

        console.log(`Received ${signal}, shutting down...`);

        try {
            const shutdownMessage = `Shutting down @ ${currentTime()} (session ${config.initId}) :wave:`;
            const currentState = await getCurrentState() ;
            if (currentState) {
                const closingMessage = await createSessionRebuildFinalMessage(
                    `Shutting down @ ${currentTime()} (session ${config.initId}) :wave:`,
                    currentState
                );
                await logMessage(
                    logConfig,
                    closingMessage  
                );
            } else {
                await logMessage(
                    logConfig,
                    shutdownMessage
                );
            }
        } catch (error) {
            console.error('Failed to send shutdown message:', error);
        }

        client.destroy();
        process.exit(0);
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    let counterLock = false;
    client.on(Events.MessageCreate, async (message) => {
        if (!counterLock && !message.author.bot && message.author.id !== config.DISCORD_BOT_ID) {
            try {
                counterLock = true;

                const channel = message.channel;
                if (channel.isTextBased() && channel.isSendable() && channel.id === config.COUNTER_TEXT_CHANNEL_ID) {
                    const messageContent = message.content.trim();
                    if (messageContent && Number.isFinite(+messageContent) && Number.isSafeInteger(+messageContent)) {
                        const messageNumber = Number(messageContent);
                        const currentState = await getCurrentState();
                        if (!currentState) {
                            return;
                        }
    
                        const expectedNumber = currentState.counter ? currentState.counter.lastNumber + 1 : 0;
    
                        if (messageNumber !== expectedNumber) {
                            await channel.sendTyping();
                            await Promise.all([
                                setCurrentState({ ...currentState, counter: undefined }),
                                message.reply('You replied with the wrong number. Starting from 0')
                            ]);
                            return;
                        }
    
                        if (currentState.counter?.lastAuthor === message.author.id) {
                            await channel.sendTyping();
                            await Promise.all([
                                setCurrentState({ ...currentState, counter: undefined }),
                                message.reply('Someone else must try. Starting from 0')
                            ]);
                            return;
                        }
    
                        await setCurrentState({ ...currentState, counter: { lastNumber: messageNumber, lastAuthor: message.author.id } });
                    }
                }

            } finally {
                counterLock = false;
            }
        }
    });

    await client.login(config.DISCORD_BOT_TOKEN);
};
