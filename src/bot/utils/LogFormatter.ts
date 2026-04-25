import { Client } from "discord.js";

export const enum LogLevel {
    INFO,
    DEBUG,
    ERROR
};

export const formatLogMessage = (config: {level: LogLevel, sessionId: string}, message: string) => {
    const errorIndicator = config.level === LogLevel.ERROR ? `**[ERROR]** ` : ''
    return `**[SYSTEM]** ${errorIndicator}(*session=${config.sessionId}*): ${message}`;
};

export const logMessage = async (config: {level: LogLevel, sessionId: string, targetChannel?: { id: string, client: Client }}, message: string) => {
    const formattedMessage = formatLogMessage(config, message);
    switch (config.level) {
        case LogLevel.DEBUG:
            console.debug(formattedMessage);
            break;
        case LogLevel.INFO:
            console.info(formattedMessage);
            break
        case LogLevel.ERROR:
            console.error(formattedMessage)
            break;
    }

    if (config.targetChannel) {
        const onChannelSend = new Promise(async (resolve) => {
            if (config.targetChannel) {
                const targetChannel = await config.targetChannel.client.channels.fetch(config.targetChannel.id);
                if (targetChannel && targetChannel.isSendable() && targetChannel.isTextBased()) {
                    await targetChannel.send(formattedMessage);
                }
            }
            resolve(0);
        });
    
        await Promise.race([
            onChannelSend,
            new Promise((_resolve, reject) => {
                setTimeout(reject, 5000);
            })
        ]);
    }
};
