import { Client, Events, GatewayIntentBits } from "discord.js";
import { type BotConfig, validateConfig } from "./types/BotConfig";
import { LogLevel, logMessage } from "./utils/LogFormatter";
import { createSessionRebuildFinalMessage, REBUILD_STATE_HEADER, reconstructSessionStateFromFinalMessage, SessionState } from "./persistence/SessionRebuilder";

const currentTime = () => new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });

export const initializeBot = async (config: BotConfig): Promise<void> => {
    const startUpTime = Date.now();
    validateConfig(config);

    const context = {
        isInit: false
    };

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const logConfig = { level: LogLevel.INFO, sessionId: config.initId, targetChannel: { client, id: config.SYSTEM_TEXT_CHANNEL_ID }};
    let activePersistedState: SessionState;

    client.once(Events.ClientReady, async (readyClient) => {
        context.isInit = true;
        
        const systemChannel = await client.channels.fetch(config.SYSTEM_TEXT_CHANNEL_ID);

        if (systemChannel && systemChannel.isTextBased()) {
            const systemMessagesCollection = await systemChannel.messages.fetch({
                limit: 100,
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
                activePersistedState = await reconstructSessionStateFromFinalMessage(
                    mostRecentMessage.content
                );
            }
        }

        const readyTime = Date.now();
        const timeTook = readyTime - startUpTime;

        const activationMessage = `ravebot is ready @ ${currentTime()}. Logged in as ${readyClient.user.tag} and took ${timeTook} ms. :wave:`;
        const finalActivationMessage = [
            activationMessage,
            ...(activePersistedState ? [
                '',
                '`RECONSTRUCTED IN-MEMORY STATE FROM LAST KNOWN SHUTDOWN:`',
                `\`${JSON.stringify(activePersistedState)}\``
            ] : [])
        ].join('\n');

        if (activePersistedState) {
            await logMessage(
                logConfig,
                finalActivationMessage
            );

            activePersistedState.generation += 1;
        } else {
            activePersistedState = {
                sessionId: config.initId,
                generation: 0
            }
        }
    });

    const shutdown = async (signal: string) => {
        if (!context.isInit){
            console.log('Abort shutdown handler due to incomplete initialization');
            process.exit(0);
        }

        console.log(`Received ${signal}, shutting down...`);

        try {
            const closingMessage = await createSessionRebuildFinalMessage(
                `Shutting down @ ${currentTime()} (session ${config.initId}) :wave:`,
                activePersistedState
            );
            await logMessage(
                logConfig,
                closingMessage  
            );
        } catch (error) {
            console.error('Failed to send shutdown message:', error);
        }

        client.destroy();
        process.exit(0);
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    await client.login(config.DISCORD_BOT_TOKEN);
};
