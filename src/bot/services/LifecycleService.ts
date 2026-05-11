import { type Client } from "discord.js";
import { type InstanceManager } from "../persistence/SessionPersistence";
import { persistSessionState } from "./PersistenceService";

interface RegisterShutdownHandlersOptions {
    client: Pick<Client, 'destroy'>;
    instanceManager: Pick<InstanceManager, 'getCurrentState' | 'getMetadata'>;
    logMessage: (message: string) => Promise<void>;
    shutdownTasks: (() => void)[];
    exit?: (code?: number) => never;
}

export const createShutdownHandler = ({
    client,
    instanceManager,
    logMessage,
    shutdownTasks,
    exit = process.exit
}: RegisterShutdownHandlersOptions) => async (signal: string): Promise<void> => {
    shutdownTasks.forEach(task => task());

    if (!instanceManager.getMetadata().isInit) {
        console.log('Abort shutdown handler due to incomplete initialization');
        exit(0);
    }

    console.log(`Received ${signal}, shutting down...`);
    await persistSessionState({
        reason: 'Shutting down',
        instanceManager,
        logMessage
    });

    client.destroy();
    exit(0);
};

export const registerShutdownHandlers = (options: RegisterShutdownHandlersOptions): void => {
    const shutdown = createShutdownHandler(options);

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
};
