import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import { type BotConfig, validateConfig } from "./types/BotConfig";
import { LogLevel, logMessage } from "./utils/LogFormatter";
import { createSessionRebuildFinalMessage, getCurrentState, REBUILD_STATE_HEADER, reconstructSessionStateFromFinalMessage, SessionState, setCurrentState } from "./persistence/SessionPersistence";
import schedule from 'node-schedule';

const currentTime = () => new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });

export const initializeBot = async (config: BotConfig): Promise<void> => {
    const shutdownTasks: Function[] = [];
    const startUpTime = Date.now();
    validateConfig(config);

    const instanceMetadata = {
        isInit: false,
        counterLock: false
    };

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });
    const logConfig = { level: LogLevel.INFO, sessionId: config.initId, targetChannel: { client, id: config.SYSTEM_TEXT_CHANNEL_ID }};

    const persistState = async (reason: 'Shutting down' | 'Running backup', lastPersistedStateId?: string) => {
        try {
            console.log('Persisting in-memory state');

            const shutdownMessage = `${reason} @ ${currentTime()}`;
            const currentState = await getCurrentState() ;
            const currentStateId = currentState ? currentState.stateId : undefined;
            if (currentState) {
                if (!(lastPersistedStateId && currentState.stateId === lastPersistedStateId)) {
                    const closingMessage = await createSessionRebuildFinalMessage(
                        shutdownMessage,
                        currentState
                    );
                    await logMessage(
                        logConfig,
                        closingMessage  
                    );
                }
            } else {
                await logMessage(
                    logConfig,
                    shutdownMessage
                );
            }

            return currentStateId;
        } catch (error) {
            console.error('Failed to send shutdown message:', error);
        }
    };

    client.once(Events.ClientReady, async (readyClient) => {
        instanceMetadata.isInit = true;
        
        await logMessage({ ...logConfig, hasDivider: true });
        const systemChannel = await client.channels.fetch(config.SYSTEM_TEXT_CHANNEL_ID);

        if (systemChannel && systemChannel.isTextBased()) {
            const MAX_RECOVERY_PAGES = 100;
            let recoveryContent: string | undefined;
            let cursorMessageId: string | undefined;

            for (let page = 0; recoveryContent === undefined && page < MAX_RECOVERY_PAGES; page++) {
                const fetchSize = 100;
                const currentCollection = await systemChannel.messages.fetch({
                    limit: fetchSize,
                    ...(cursorMessageId && { before: cursorMessageId })
                });
                await logMessage(logConfig, `Instance rebuild fetched ${currentCollection.size} messages on page ${page}`);
                if (currentCollection.size === 0) {
                    break
                };

                const sorted = [...currentCollection.values()].sort((a, b) =>
                    b.createdTimestamp - a.createdTimestamp
                );

                const messageMatch = sorted.find(message =>
                    message.author.bot
                    && message.author.id === config.DISCORD_BOT_ID
                    && message.content.split('\n').at(-2) === REBUILD_STATE_HEADER
                );

                if (messageMatch) {
                    recoveryContent = messageMatch.content;
                    await logMessage(logConfig, 'Instance rebuild located backup :tada:');
                } else {
                    cursorMessageId = sorted[sorted.length - 1].id;
                    await logMessage(logConfig, 'Instance rebuild failed to locate backup. Waiting 5 seconds.');
                    await new Promise((resolve) => {
                        setTimeout(resolve, 5000);
                    });
                }
            }

            if (recoveryContent !== undefined) {
                try {
                    const persistedState = await reconstructSessionStateFromFinalMessage(recoveryContent);
                    await setCurrentState(persistedState);
                } catch (error) {
                    console.error('Failed to reconstruct session state:', error);
                }
            }
        }

        const readyTime = Date.now();
        const timeTook = readyTime - startUpTime;

        const activationMessage = `ravebot is ready @ ${currentTime()}.\nLogged in as ${readyClient.user.tag} and took ${timeTook} ms.`;
        const currentState = await getCurrentState();
        const finalActivationMessage = [
            activationMessage,
            ...(currentState ? [
                '',
                '`RECONSTRUCTED FROM LAST KNOWN SHUTDOWN:`',
                `\`${JSON.stringify(currentState)}\``
            ] : [])
        ].join('\n');

        if (currentState) {
            await logMessage(
                { ...logConfig },
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

        readyClient.user.setActivity({
            name: 'Botting',
            type: ActivityType.Custom
        });

        setTimeout(async () => {
            let lastBackupStateId: string | undefined;
            const backupMinute = '59';
            await logMessage(logConfig, `Starting delta backup at the ${backupMinute}th minute of the hour`);
            const job = schedule.scheduleJob(`${backupMinute} * * * *`, async () => {
                lastBackupStateId = await persistState('Running backup', lastBackupStateId);
            });
            shutdownTasks.push(() => {
                job.cancel();
            });
        }, 10000);
    });

    const shutdown = async (signal: string) => {
        shutdownTasks.forEach(task => task());

        if (!instanceMetadata.isInit){
            console.log('Abort shutdown handler due to incomplete initialization');
            process.exit(0);
        }

        console.log(`Received ${signal}, shutting down...`);
        await persistState('Shutting down');

        client.destroy();
        process.exit(0);
    };

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));

    client.on(Events.MessageCreate, async (message) => {
        if (!message.author.bot && message.author.id !== config.DISCORD_BOT_ID) {
            const channel = message.channel;

            // Counting game
            if (!instanceMetadata.counterLock && channel.isTextBased() && channel.isSendable() && channel.id === config.COUNTER_TEXT_CHANNEL_ID) {
                try {
                    instanceMetadata.counterLock = true;
                    const messageContent = message.content.trim();
                    if (messageContent && Number.isFinite(+messageContent) && Number.isSafeInteger(+messageContent)) {
                        const messageNumber = Number(messageContent);
                        const currentState = await getCurrentState();
                        if (!currentState) {
                            return;
                        }
    
                        const failureRules = [
                            {
                                message: 'You replied with the wrong number. Restarting from 0.',
                                rule: () => {
                                    const expectedNumber = currentState.counter ? currentState.counter.lastNumber + 1 : 0;
                                    return messageNumber !== expectedNumber;
                                }
                            },
                            {
                                message: 'Someone else must try. Restarting from 0.',
                                rule: () => {
                                    return currentState.counter?.lastAuthor === message.author.id;
                                }
                            },
                        ];

                        for (const failureRule of failureRules) {
                            if (failureRule.rule()) {
                                // Fail
                                await channel.sendTyping();
                                await Promise.all([
                                    setCurrentState({ ...currentState, counter: undefined }),
                                    message.reply(failureRule.message)
                                ]);
                                return;
                            }
                        }
    
                        // Success
                        await setCurrentState({ ...currentState, counter: { lastNumber: messageNumber, lastAuthor: message.author.id } });
                    }
                } finally {
                    instanceMetadata.counterLock = false;
                }
            }
        }
    });

    await client.login(config.DISCORD_BOT_TOKEN);
};
