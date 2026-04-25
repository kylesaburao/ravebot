import { Client, Events, GatewayIntentBits } from "discord.js";
import { BotConfig, validateConfig } from "./types/BotConfig";

const SHUTDOWN_TIMEOUT_MS = 5000;

const currentTime = () => new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });

export const initializeBot = async (config: BotConfig): Promise<void> => {
    validateConfig(config);

    const context = {
        isInit: false
    };
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });

    client.once(Events.ClientReady, async (readyClient) => {
        context.isInit = true;

        const systemMessage = `Client is ready @ ${currentTime()}. Logged in as ${readyClient.user.tag} under session ${config.initId} :wave:`;
        console.log(systemMessage);

        const systemChannel = await client.channels.fetch(config.SYSTEM_TEXT_CHANNEL_ID);
        if (!systemChannel || !(systemChannel.isSendable() && systemChannel.isTextBased())) {
            throw new Error('Could not locate system channel');
        }
        systemChannel.send(systemMessage);
    });

    const shutdown = async (signal: string) => {
        if (!context.isInit){
            console.log('Abort shutdown handler due to incomplete initialization');
            process.exit(0);
        }

        console.log(`Received ${signal}, shutting down...`);

        if (signal === 'SIGINT' || signal === 'SIGTERM') {
            try {
                const systemChannel = await Promise.race([
                    client.channels.fetch(config.SYSTEM_TEXT_CHANNEL_ID),
                    new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), SHUTDOWN_TIMEOUT_MS))
                ]);
    
                if (systemChannel && systemChannel.isSendable() && systemChannel.isTextBased()) {
                    await Promise.race([
                        systemChannel.send(`Shutting down @ ${currentTime()} (session ${config.initId}) :wave:`),
                        new Promise<void>((_, reject) => setTimeout(() => reject(new Error('timeout')), SHUTDOWN_TIMEOUT_MS))
                    ]);
                }
            } catch (error) {
                console.error('Failed to send shutdown message:', error);
            }
        }

        client.destroy();
        process.exit(0);
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    await client.login(config.DISCORD_BOT_TOKEN);
};
