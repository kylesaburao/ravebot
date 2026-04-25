import { BotConfig } from "./types/BotConfig";

const validateConfig = (config: BotConfig) => {
    if (!config.DISCORD_BOT_TOKEN) {
        throw new Error('DISCORD_BOT_TOKEN must be set');
    }
};

export const initializeBot = async (config: BotConfig): Promise<void> => {
    validateConfig(config);
    const { } = config;
};
