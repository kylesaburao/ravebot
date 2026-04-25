import { Client, Events, GatewayIntentBits } from "discord.js";
import { type BotConfig, validateConfig } from "./types/BotConfig";
import { LogLevel, logMessage } from "./utils/LogFormatter";

const currentTime = () => new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });

export const initializeBot = async (config: BotConfig): Promise<void> => {
    const startUpTime = Date.now();
    validateConfig(config);

    const context = {
        isInit: false
    };

    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    const logConfig = { level: LogLevel.INFO, sessionId: config.initId, targetChannel: { client, id: config.SYSTEM_TEXT_CHANNEL_ID }}

    client.once(Events.ClientReady, async (readyClient) => {
        context.isInit = true;
        const readyTime = Date.now();
        const timeTook = readyTime - startUpTime;

        await logMessage(
            logConfig,
            `ravebot is ready @ ${currentTime()}. Logged in as ${readyClient.user.tag} and took ${timeTook} ms. :wave:`
        );
    });

    const shutdown = async (signal: string) => {
        if (!context.isInit){
            console.log('Abort shutdown handler due to incomplete initialization');
            process.exit(0);
        }

        console.log(`Received ${signal}, shutting down...`);

        try {
            await logMessage(
                logConfig,
                `Shutting down @ ${currentTime()} (session ${config.initId}) :wave:`
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
