import { type Client } from "discord.js";
import {
    REBUILD_STATE_HEADER,
    reconstructSessionStateFromFinalMessage,
    type InstanceManager
} from "../persistence/SessionPersistence";
import { type BotConfig } from "../types/BotConfig";

interface RecoveryMessage {
    id: string;
    content: string;
    createdTimestamp: number;
    author: {
        bot: boolean;
        id: string;
    };
}

interface RecoveryMessageCollection {
    size: number;
    values(): IterableIterator<RecoveryMessage>;
}

interface RecoveryChannel {
    messages: {
        fetch(options: { limit: number; before?: string }): Promise<RecoveryMessageCollection>;
    };
}

interface RecoverSessionStateOptions {
    client: Pick<Client, 'channels'>;
    config: Pick<BotConfig, 'SYSTEM_TEXT_CHANNEL_ID' | 'DISCORD_BOT_ID'>;
    instanceManager: Pick<InstanceManager, 'runAtomicStateUpdate'>;
    logMessage: (message: string) => Promise<void>;
    maxRecoveryPages?: number;
    fetchSize?: number;
    retryDelayMs?: number;
}

const delay = (ms: number) => new Promise(resolve => {
    setTimeout(resolve, ms);
});

export const findRecoveryContent = async ({
    channel,
    botId,
    logMessage,
    maxRecoveryPages = 100,
    fetchSize = 100,
    retryDelayMs = 5000
}: {
    channel: RecoveryChannel;
    botId: string;
    logMessage: (message: string) => Promise<void>;
    maxRecoveryPages?: number;
    fetchSize?: number;
    retryDelayMs?: number;
}): Promise<string | undefined> => {
    let cursorMessageId: string | undefined;

    for (let page = 0; page < maxRecoveryPages; page++) {
        const currentCollection = await channel.messages.fetch({
            limit: fetchSize,
            ...(cursorMessageId && { before: cursorMessageId })
        });
        await logMessage(`Instance rebuild fetched ${currentCollection.size} messages on page ${page}`);

        if (currentCollection.size === 0) {
            break;
        }

        const sorted = [...currentCollection.values()].sort((a, b) =>
            b.createdTimestamp - a.createdTimestamp
        );

        const messageMatch = sorted.find(message =>
            message.author.bot
            && message.author.id === botId
            && message.content.split('\n').at(-2) === REBUILD_STATE_HEADER
        );

        if (messageMatch) {
            await logMessage('Instance rebuild located backup :tada:');
            return messageMatch.content;
        }

        cursorMessageId = sorted[sorted.length - 1].id;
        await logMessage('Instance rebuild failed to locate backup. Waiting 5 seconds.');
        await delay(retryDelayMs);
    }

    return undefined;
};

export const recoverSessionState = async ({
    client,
    config,
    instanceManager,
    logMessage,
    maxRecoveryPages,
    fetchSize,
    retryDelayMs
}: RecoverSessionStateOptions): Promise<void> => {
    let recoveryContent: string | undefined;

    try {
        const systemChannel = await client.channels.fetch(config.SYSTEM_TEXT_CHANNEL_ID);

        if (!systemChannel || !systemChannel.isTextBased()) {
            return;
        }

        recoveryContent = await findRecoveryContent({
            channel: systemChannel as unknown as RecoveryChannel,
            botId: config.DISCORD_BOT_ID,
            logMessage,
            maxRecoveryPages,
            fetchSize,
            retryDelayMs
        });
    } catch (error) {
        console.error('Failed to recover session state:', error);
        return;
    }

    if (recoveryContent === undefined) {
        return;
    }

    try {
        const persistedState = await reconstructSessionStateFromFinalMessage(recoveryContent);
        await instanceManager.runAtomicStateUpdate(async (_, writeState) => {
            await writeState(persistedState);
        });
    } catch (error) {
        console.error('Failed to reconstruct session state:', error);
    }
};
