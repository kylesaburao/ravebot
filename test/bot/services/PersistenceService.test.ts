import { createSessionRebuildFinalMessage, type SessionState } from "../../../src/bot/persistence/SessionPersistence";
import { persistSessionState } from "../../../src/bot/services/PersistenceService";
import { BackupReason } from "../../../src/bot/types/Constants";

const state: SessionState = {
    stateId: 'state-1',
    sessionId: 'session-1',
    generation: 0
};

const createManager = (currentState?: SessionState) => ({
    getCurrentState: jest.fn().mockResolvedValue(currentState)
});

describe('persistSessionState', () => {
    it('writes automatic backups when state changed', async () => {
        const logMessage = jest.fn().mockResolvedValue(undefined);
        const manager = createManager(state);

        const result = await persistSessionState({
            reason: BackupReason.AUTOMATIC,
            lastPersistedStateId: 'older-state',
            instanceManager: manager,
            logMessage,
            getTime: () => 'now'
        });

        expect(result).toEqual({ currentStateId: 'state-1', didRun: true });
        expect(logMessage).toHaveBeenCalledWith(await createSessionRebuildFinalMessage('Automatic backup @ now', state));
    });

    it('skips automatic backups when state is unchanged', async () => {
        const logMessage = jest.fn().mockResolvedValue(undefined);

        const result = await persistSessionState({
            reason: BackupReason.AUTOMATIC,
            lastPersistedStateId: state.stateId,
            instanceManager: createManager(state),
            logMessage,
            getTime: () => 'now'
        });

        expect(result).toEqual({ currentStateId: 'state-1', didRun: false });
        expect(logMessage).not.toHaveBeenCalled();
    });

    it('writes manual backups even when state is unchanged', async () => {
        const logMessage = jest.fn().mockResolvedValue(undefined);

        const result = await persistSessionState({
            reason: BackupReason.MANUAL,
            lastPersistedStateId: state.stateId,
            instanceManager: createManager(state),
            logMessage,
            getTime: () => 'now'
        });

        expect(result).toEqual({ currentStateId: 'state-1', didRun: true });
        expect(logMessage).toHaveBeenCalledWith(await createSessionRebuildFinalMessage('Manual backup @ now', state));
    });

    it('writes a plain shutdown message when no state exists', async () => {
        const logMessage = jest.fn().mockResolvedValue(undefined);

        const result = await persistSessionState({
            reason: BackupReason.SHUTDOWN,
            instanceManager: createManager(undefined),
            logMessage,
            getTime: () => 'now'
        });

        expect(result).toEqual({ currentStateId: undefined, didRun: true });
        expect(logMessage).toHaveBeenCalledWith('Shutdown backup @ now');
    });

    it('preserves original shutdown-label behavior when state exists', async () => {
        const logMessage = jest.fn().mockResolvedValue(undefined);

        const result = await persistSessionState({
            reason: 'Shutting down',
            instanceManager: createManager(state),
            logMessage,
            getTime: () => 'now'
        });

        expect(result).toEqual({ currentStateId: 'state-1', didRun: true });
        expect(logMessage).toHaveBeenCalledWith(await createSessionRebuildFinalMessage('Shutting down @ now', state));
    });

    it('preserves original no-op behavior for a custom reason when no state exists', async () => {
        const logMessage = jest.fn().mockResolvedValue(undefined);

        const result = await persistSessionState({
            reason: 'Shutting down',
            instanceManager: createManager(undefined),
            logMessage,
            getTime: () => 'now'
        });

        expect(result).toEqual({ currentStateId: undefined, didRun: false });
        expect(logMessage).not.toHaveBeenCalled();
    });
});
