import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import { type BotConfig, validateConfig } from "./types/BotConfig";
import { LogLevel, logMessage } from "./utils/LogFormatter";
import { createSessionRebuildFinalMessage, InstanceManager, REBUILD_STATE_HEADER, reconstructSessionStateFromFinalMessage } from "./persistence/SessionPersistence";
import schedule from 'node-schedule';
import { registerCounterGame } from "./events/CounterGame";
import { EventRegister } from "./events/types/EventTypes";

const getCurrentTime = () => new Date().toLocaleString('en-US', { timeZone: 'America/Vancouver', timeZoneName: 'short' });

export const initializeBot = async (config: BotConfig): Promise<void> => {
    const shutdownTasks: Function[] = [];
    const startUpTime = Date.now();
    validateConfig(config);

    const instanceManager = new InstanceManager();

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

            const shutdownMessage = `${reason} @ ${getCurrentTime()}`;
            const currentState = await instanceManager.getCurrentState();
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
        instanceManager.setMetadata({ isInit: true });
        
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
                    const { stateId: _, ...persistedState } = await reconstructSessionStateFromFinalMessage(recoveryContent);
                    await instanceManager.runAtomicStateUpdate(async (_, writeState) => {
                        await writeState(persistedState);
                    });
                } catch (error) {
                    console.error('Failed to reconstruct session state:', error);
                }
            }
        }

        await instanceManager.runAtomicStateUpdate(async (currentState, writeState) => {
            const timeTook = Date.now() - startUpTime;
            const activationMessage = `ravebot is ready @ ${getCurrentTime()}.\nLogged in as ${readyClient.user.tag} and took ${timeTook} ms.`;
            const finalActivationMessage = [
                activationMessage,
                ...(currentState ? [
                    '',
                    '`RECONSTRUCTED FROM LAST KNOWN SHUTDOWN:`',
                    `\`${JSON.stringify(currentState)}\``
                ] : [])
            ].join('\n');

            if (currentState) {
                await logMessage(logConfig, finalActivationMessage);
                await writeState({ generation: currentState.generation + 1 });
            } else {
                await writeState({ sessionId: config.initId, generation: 0 });
            }
        });

        readyClient.user.setActivity({
            name: 'Botting',
            type: ActivityType.Custom
        });

        setTimeout(async () => {
            let lastBackupStateId: string | undefined = (await instanceManager.getCurrentState())?.stateId;
            const backupMinute = '59';

            await logMessage(logConfig, `Starting delta backup at the ${backupMinute}th minute of the hour`);
            const job = schedule.scheduleJob(`${backupMinute} * * * *`, async () => {
                lastBackupStateId = await persistState('Running backup', lastBackupStateId);
            });
            shutdownTasks.push(() => {
                job.cancel();
            });
        }, 0);
    });

    const shutdown = async (signal: string) => {
        shutdownTasks.forEach(task => task());

        if (!instanceManager.getMetadata().isInit) {
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

    const eventRegisters: EventRegister[] = [
        registerCounterGame
    ];
    eventRegisters.forEach(eventRegister => eventRegister(client, config, instanceManager));

    await client.login(config.DISCORD_BOT_TOKEN);
};
