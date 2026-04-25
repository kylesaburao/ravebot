export interface BotConfig {
    DISCORD_BOT_TOKEN: string;
    DISCORD_BOT_ID: string;
    SYSTEM_TEXT_CHANNEL_ID: string;
    initId: string;
}

export const validateConfig = (config: BotConfig) => {
    if (!config.DISCORD_BOT_TOKEN) {
        throw new Error('DISCORD_BOT_TOKEN must be set');
    }
    if (!config.DISCORD_BOT_ID) {
        throw new Error('DISCORD_BOT_ID must be set');
    }    
    if (!config.SYSTEM_TEXT_CHANNEL_ID) {
        throw new Error('SYSTEM_TEXT_CHANNEL_ID must be set');
    }
    if (!config.initId) {
        throw new Error('initId must be set');
    }
};
