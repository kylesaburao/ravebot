import { InstanceManager, reconstructSessionStateFromFinalMessage, type SessionState } from "../../../src/bot/persistence/SessionPersistence";
import { registerBackupScheduler } from "../../../src/bot/services/BackupService";
import { BackupReason, EventBackupBusIds, EventBusId, TaskQueueId } from "../../../src/bot/types/Constants";

class FakeCron {
    static instances: FakeCron[] = [];

    readonly expression: string;
    readonly options: Record<string, unknown>;
    readonly task: () => Promise<void>;
    readonly stop = jest.fn();

    constructor(expression: string, options: Record<string, unknown>, task: () => Promise<void>) {
        this.expression = expression;
        this.options = options;
        this.task = task;
        FakeCron.instances.push(this);
    }

    nextRun(): Date | null {
        return null;
    }
}

const seedState = async (instanceManager: InstanceManager, state: Omit<SessionState, 'stateId'>) => {
    await instanceManager.runAtomicStateUpdate(async (_currentState, writeState) => {
        await writeState(state);
    });
};

const setupInstanceManager = () => {
    const instanceManager = new InstanceManager();
    instanceManager.registerTaskQueue(TaskQueueId.BACKUP, 1);
    instanceManager.registerEventBus(EventBusId.BACKUP_BUS);
    return instanceManager;
};

describe('registerBackupScheduler', () => {
    beforeEach(() => {
        FakeCron.instances = [];
    });

    it('registers automatic and keep-alive cron tasks with existing schedules', async () => {
        const instanceManager = setupInstanceManager();
        const logMessage = jest.fn().mockResolvedValue(undefined);

        const stop = await registerBackupScheduler({
            instanceManager,
            logMessage,
            createCron: FakeCron
        });

        expect(FakeCron.instances.map(instance => instance.expression)).toEqual([
            '*/5 * * * *',
            '59 1 * * *'
        ]);
        expect(FakeCron.instances[1].options).toEqual({ timezone: "America/Vancouver" });
        expect(logMessage).toHaveBeenCalledWith('Started backup at 5 minute intervals.');

        stop();
        expect(FakeCron.instances[0].stop).toHaveBeenCalledTimes(1);
        expect(FakeCron.instances[1].stop).toHaveBeenCalledTimes(1);
    });

    it('preserves automatic backup skip behavior when state is unchanged', async () => {
        const instanceManager = setupInstanceManager();
        const logMessage = jest.fn().mockResolvedValue(undefined);
        await seedState(instanceManager, { sessionId: 'session-1', generation: 0 });

        await registerBackupScheduler({
            instanceManager,
            logMessage,
            createCron: FakeCron
        });
        logMessage.mockClear();

        await instanceManager.getEventBus(EventBusId.BACKUP_BUS)!.notify(EventBackupBusIds.RUN_BACKUP);

        expect(logMessage).not.toHaveBeenCalled();
    });

    it('preserves manual backup behavior even when state is unchanged', async () => {
        const instanceManager = setupInstanceManager();
        const logMessage = jest.fn().mockResolvedValue(undefined);
        await seedState(instanceManager, { sessionId: 'session-1', generation: 0 });
        const state = await instanceManager.getCurrentState();

        await registerBackupScheduler({
            instanceManager,
            logMessage,
            createCron: FakeCron
        });
        logMessage.mockClear();

        await instanceManager.getEventBus(EventBusId.BACKUP_BUS)!.notify(EventBackupBusIds.RUN_BACKUP, { reason: BackupReason.MANUAL });

        const [manualBackupMessage] = logMessage.mock.calls[0];
        expect(manualBackupMessage.split('\n')[0]).toContain('Manual backup @');
        await expect(reconstructSessionStateFromFinalMessage(manualBackupMessage)).resolves.toEqual(state);
    });

    it('updates lastBackupStateId after a write so subsequent unchanged auto-backups are skipped', async () => {
        const instanceManager = setupInstanceManager();
        const logMessage = jest.fn().mockResolvedValue(undefined);
        await seedState(instanceManager, { sessionId: 'session-1', generation: 0 });

        await registerBackupScheduler({ instanceManager, logMessage, createCron: FakeCron });

        const backupBus = instanceManager.getEventBus(EventBusId.BACKUP_BUS)!;

        // Baseline: state unchanged since registration → skip
        logMessage.mockClear();
        await backupBus.notify(EventBackupBusIds.RUN_BACKUP);
        expect(logMessage).not.toHaveBeenCalled();

        // Mutate state → backup writes and updates lastBackupStateId
        await instanceManager.runAtomicStateUpdate(async (_, writeState) => {
            await writeState({ generation: 1 });
        });
        await backupBus.notify(EventBackupBusIds.RUN_BACKUP);
        expect(logMessage).toHaveBeenCalledTimes(1);

        // State unchanged again → dedup kicks in with the new id
        logMessage.mockClear();
        await backupBus.notify(EventBackupBusIds.RUN_BACKUP);
        expect(logMessage).not.toHaveBeenCalled();
    });

    it('keep-alive task generates a new stateId that unblocks the next auto-backup', async () => {
        const instanceManager = setupInstanceManager();
        const logMessage = jest.fn().mockResolvedValue(undefined);
        await seedState(instanceManager, { sessionId: 'session-1', generation: 0 });

        await registerBackupScheduler({ instanceManager, logMessage, createCron: FakeCron });

        const backupBus = instanceManager.getEventBus(EventBusId.BACKUP_BUS)!;
        const initialStateId = (await instanceManager.getCurrentState())!.stateId;

        // Confirm auto-backup would skip without keep-alive
        logMessage.mockClear();
        await backupBus.notify(EventBackupBusIds.RUN_BACKUP);
        expect(logMessage).not.toHaveBeenCalled();

        // Fire keep-alive — it writes state back, producing a fresh stateId
        const keepAliveTask = FakeCron.instances[1];
        expect(keepAliveTask.expression).toBe('59 1 * * *');
        await keepAliveTask.task();
        expect((await instanceManager.getCurrentState())!.stateId).not.toBe(initialStateId);

        // Now auto-backup runs because stateId diverged from lastBackupStateId
        await backupBus.notify(EventBackupBusIds.RUN_BACKUP);
        expect(logMessage).toHaveBeenCalledTimes(1);
    });
});
