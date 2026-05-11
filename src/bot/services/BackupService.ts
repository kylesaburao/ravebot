import { Cron } from "croner";
import { type InstanceManager } from "../persistence/SessionPersistence";
import { BackupReason, EventBackupBusIds, EventBusId, TaskQueueId } from "../types/Constants";
import { getDateLocaleString } from "../utils/TimeUtils";
import { persistSessionState } from "./PersistenceService";

interface ScheduledTask {
    nextRun(): Date | null;
    stop(): void;
}

type SchedulerFactory = new (
    expression: string,
    options: Record<string, unknown>,
    task: () => Promise<void>
) => ScheduledTask;

interface RegisterBackupSchedulerOptions {
    instanceManager: InstanceManager;
    logMessage: (message: string) => Promise<void>;
    minuteInterval?: string;
    createCron?: SchedulerFactory;
}

export const registerBackupScheduler = async ({
    instanceManager,
    logMessage,
    minuteInterval = '5',
    createCron = Cron as SchedulerFactory
}: RegisterBackupSchedulerOptions): Promise<() => void> => {
    let lastBackupStateId: string | undefined = (await instanceManager.getCurrentState())?.stateId;

    const getNextRunMessage = (date: Date | null) => date
        ? `Next scheduled backup attempt @ ${getDateLocaleString(date)}.`
        : '';

    const backupTaskQueue = instanceManager.getTaskQueue(TaskQueueId.BACKUP);
    const backupEventBus = instanceManager.getEventBus(EventBusId.BACKUP_BUS);
    if (!backupTaskQueue || !backupEventBus) {
        throw new Error('Failed to initialize the backup task queue');
    }

    backupEventBus.on(EventBackupBusIds.RUN_BACKUP, async (params) => {
        let reason = BackupReason.AUTOMATIC;
        if (params?.['reason'] === BackupReason.MANUAL) {
            reason = BackupReason.MANUAL;
        }

        await backupTaskQueue.schedule(async () => {
            const { currentStateId: backupStateId, didRun } = await persistSessionState({
                reason,
                lastPersistedStateId: lastBackupStateId,
                instanceManager,
                logMessage
            }) || {};
            lastBackupStateId = backupStateId;
            const nextRunMessage = getNextRunMessage(backupTask.nextRun());
            if (didRun && nextRunMessage) {
                await logMessage(nextRunMessage);
            }
        });
    });

    const backupTask = new createCron(`*/${minuteInterval} * * * *`, {}, async () => {
        await backupEventBus.notify(EventBackupBusIds.RUN_BACKUP);
    });

    const channelKeepAliveTask = new createCron(`59 1 * * *`, { timezone: "America/Vancouver" }, async () => {
        await instanceManager.runAtomicStateUpdate(async (currentState, writeState) => {
            if (currentState) {
                await writeState(currentState);
            }
        });
    });

    const startupRunMessage = getNextRunMessage(backupTask.nextRun());
    const message = [
        `Started backup at ${minuteInterval} minute intervals.`,
        ...(startupRunMessage ? [startupRunMessage] : [])
    ].join('\n');
    await logMessage(message);

    return () => {
        backupTask.stop();
        channelKeepAliveTask.stop();
    };
};
