import { type SessionState } from "../../../src/bot/persistence/SessionPersistence";
import { createShutdownHandler } from "../../../src/bot/services/LifecycleService";

const state: SessionState = {
    stateId: 'state-1',
    sessionId: 'session-1',
    generation: 0
};

describe('createShutdownHandler', () => {
    it('stops cleanup tasks, persists shutdown state, destroys the client, and exits', async () => {
        const cleanup = jest.fn();
        const destroy = jest.fn();
        const logMessage = jest.fn().mockResolvedValue(undefined);
        const exit = jest.fn(() => {
            throw new Error('exit');
        }) as unknown as (code?: number) => never;

        const shutdown = createShutdownHandler({
            client: { destroy },
            instanceManager: {
                getMetadata: () => ({ isInit: true }),
                getCurrentState: jest.fn().mockResolvedValue(state)
            },
            logMessage,
            shutdownTasks: [cleanup],
            exit
        });

        await expect(shutdown('SIGTERM')).rejects.toThrow('exit');
        expect(cleanup).toHaveBeenCalledTimes(1);
        expect(logMessage.mock.calls[0][0]).toContain('Shutting down @');
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
    });

    it('exits immediately without persisting or destroying when isInit is false', async () => {
        const getCurrentState = jest.fn();
        const destroy = jest.fn();
        const logMessage = jest.fn();
        const exit = jest.fn(() => {
            throw new Error('exit');
        }) as unknown as (code?: number) => never;

        const shutdown = createShutdownHandler({
            client: { destroy },
            instanceManager: {
                getMetadata: () => ({ isInit: false }),
                getCurrentState
            },
            logMessage,
            shutdownTasks: [],
            exit
        });

        await expect(shutdown('SIGTERM')).rejects.toThrow('exit');
        expect(getCurrentState).not.toHaveBeenCalled();
        expect(logMessage).not.toHaveBeenCalled();
        expect(destroy).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(0);
    });
});
