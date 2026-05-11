import { ActivityType, Client, Events, GatewayIntentBits } from "discord.js";
import { type BotConfig, validateConfig } from "./types/BotConfig";
import { LogLevel, logMessage } from "./utils/LogFormatter";
import { InstanceManager } from "./persistence/SessionPersistence";
import { registerCounterGame } from "./events/CounterGame";
import { type EventRegister } from "./events/types/EventTypes";
import { EventBusId, TaskQueueId } from "./types/Constants";
import { registerDebugHandlers } from "./events/DebugHandler";
import { getCurrentTime } from "./utils/TimeUtils";
import { recoverSessionState } from "./services/RecoveryService";
import { registerBackupScheduler } from "./services/BackupService";
import { registerShutdownHandlers } from "./services/LifecycleService";

export const initializeBot = async (config: BotConfig): Promise<void> => {
    const shutdownTasks: (() => void)[] = [];
    const startUpTime = Date.now();
    validateConfig(config);

    const instanceManager = new InstanceManager();
    instanceManager.registerTaskQueue(TaskQueueId.SYNCHRONOUS, 1);
    instanceManager.registerTaskQueue(TaskQueueId.BACKUP, 1);
    instanceManager.registerEventBus(EventBusId.MAIN);
    instanceManager.registerEventBus(EventBusId.BACKUP_BUS);

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent
        ]
    });
    const logConfig = { level: LogLevel.INFO, sessionId: config.initId, targetChannel: { client, id: config.SYSTEM_TEXT_CHANNEL_ID }};
    const logSystemMessage = (message: string) => logMessage(logConfig, message);

    client.once(Events.ClientReady, async (readyClient) => {
        instanceManager.setMetadata({ isInit: true });
        
        await logMessage({ ...logConfig, hasDivider: true });
        await recoverSessionState({
            client,
            config,
            instanceManager,
            logMessage: logSystemMessage
        });

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
            shutdownTasks.push(await registerBackupScheduler({
                instanceManager,
                logMessage: logSystemMessage
            }));
        }, 0);
    });

    registerShutdownHandlers({
        client,
        instanceManager,
        logMessage: logSystemMessage,
        shutdownTasks
    });

    const eventRegisters: EventRegister[] = [
        registerCounterGame,
        registerDebugHandlers
    ];
    eventRegisters.forEach(eventRegister => eventRegister(client, config, instanceManager));

    await client.login(config.DISCORD_BOT_TOKEN);
};
