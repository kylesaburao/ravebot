import { gzipSync } from 'zlib';
import type { SessionState } from '../../../src/bot/persistence/SessionPersistence';
import {
    createSessionRebuildContentMessage,
    createSessionRebuildFinalMessage,
    InstanceManager,
    reconstructSessionRebuildContent,
    reconstructSessionStateFromFinalMessage,
} from '../../../src/bot/persistence/SessionPersistence';

describe('InstanceManager', () => {
    describe('getMetadata / setMetadata', () => {
        it('returns default metadata on first construction', () => {
            const manager = new InstanceManager();
            expect(manager.getMetadata()).toEqual({ isInit: false });
        });

        it('returns a copy — mutating the result does not affect internal state', () => {
            const manager = new InstanceManager();
            const snapshot = manager.getMetadata();
            snapshot.isInit = true;
            expect(manager.getMetadata().isInit).toBe(false);
        });

        it('overlays partial updates onto existing metadata', () => {
            const manager = new InstanceManager();
            manager.setMetadata({ isInit: true });
            expect(manager.getMetadata()).toEqual({ isInit: true });
        });
    });

    describe('getCurrentState / writeState', () => {
        const write = (manager: InstanceManager, update: Partial<Omit<SessionState, 'stateId'>>) =>
            manager.runAtomicStateUpdate(async (_, writeState) => writeState(update));

        it('returns undefined before any state is set', async () => {
            const manager = new InstanceManager();
            await expect(manager.getCurrentState()).resolves.toBeUndefined();
        });

        it('returns a copy — mutating the result does not affect internal state', async () => {
            const manager = new InstanceManager();
            await write(manager, { sessionId: 'abc', generation: 0 });
            const snapshot = await manager.getCurrentState();
            snapshot!.sessionId = 'mutated';
            expect((await manager.getCurrentState())!.sessionId).toBe('abc');
        });

        it('assigns a stateId on write', async () => {
            const manager = new InstanceManager();
            await write(manager, { sessionId: 'abc', generation: 0 });
            const state = await manager.getCurrentState();
            expect(typeof state!.stateId).toBe('string');
            expect(state!.stateId.length).toBeGreaterThan(0);
        });

        it('generates a new stateId on each update', async () => {
            const manager = new InstanceManager();
            await write(manager, { sessionId: 'abc', generation: 0 });
            const first = (await manager.getCurrentState())!.stateId;
            await write(manager, { generation: 1 });
            const second = (await manager.getCurrentState())!.stateId;
            expect(first).not.toBe(second);
        });

        it('overlays partial updates onto existing state', async () => {
            const manager = new InstanceManager();
            await write(manager, { sessionId: 'abc', generation: 0 });
            await write(manager, { generation: 1 });
            const state = await manager.getCurrentState();
            expect(state!.sessionId).toBe('abc');
            expect(state!.generation).toBe(1);
        });

    });

    describe('runStateUpdate', () => {
        it('calls callback with undefined when no state exists', async () => {
            const manager = new InstanceManager();
            let received: SessionState | undefined = {} as any;
            await manager.runAtomicStateUpdate(async (currentState) => { received = currentState; });
            expect(received).toBeUndefined();
        });

        it('calls callback with a snapshot of current state', async () => {
            const manager = new InstanceManager();
            await manager.runAtomicStateUpdate(async (_, writeState) => writeState({ sessionId: 'abc', generation: 0 }));
            let received: SessionState | undefined;
            await manager.runAtomicStateUpdate(async (currentState) => { received = currentState; });
            expect(received!.sessionId).toBe('abc');
        });

        it('writes state via writeState', async () => {
            const manager = new InstanceManager();
            await manager.runAtomicStateUpdate(async (_, writeState) => writeState({ sessionId: 'abc', generation: 0 }));
            await manager.runAtomicStateUpdate(async (_, writeState) => writeState({ generation: 1 }));
            expect((await manager.getCurrentState())!.generation).toBe(1);
        });

        it('queues concurrent calls in order', async () => {
            const manager = new InstanceManager();
            const order: number[] = [];
            const p0 = manager.runAtomicStateUpdate(async (_, writeState) => writeState({ sessionId: 'abc', generation: 0 }));
            const p1 = manager.runAtomicStateUpdate(async (_, writeState) => { order.push(1); await writeState({ generation: 1 }); });
            const p2 = manager.runAtomicStateUpdate(async (_, writeState) => { order.push(2); await writeState({ generation: 2 }); });
            await Promise.all([p0, p1, p2]);
            expect(order).toEqual([1, 2]);
            expect((await manager.getCurrentState())!.generation).toBe(2);
        });

        it('second call sees state written by first', async () => {
            const manager = new InstanceManager();
            const p0 = manager.runAtomicStateUpdate(async (_, writeState) => writeState({ sessionId: 'abc', generation: 0 }));
            const p1 = manager.runAtomicStateUpdate(async (_, writeState) => writeState({ generation: 1 }));
            const p2 = manager.runAtomicStateUpdate(async (currentState) => {
                expect(currentState!.generation).toBe(1);
            });
            await Promise.all([p0, p1, p2]);
        });

        it('propagates callback errors to the caller', async () => {
            const manager = new InstanceManager();
            await expect(
                manager.runAtomicStateUpdate(async () => { throw new Error('boom'); })
            ).rejects.toThrow('boom');
        });

        it('continues processing after a failed call', async () => {
            const manager = new InstanceManager();
            await manager.runAtomicStateUpdate(async (_, writeState) => writeState({ sessionId: 'abc', generation: 0 }));
            await manager.runAtomicStateUpdate(async () => { throw new Error('boom'); }).catch(() => {});
            await manager.runAtomicStateUpdate(async (_, writeState) => writeState({ generation: 1 }));
            expect((await manager.getCurrentState())!.generation).toBe(1);
        });

        it('rejects and preserves the first write when writeState is called twice', async () => {
            const manager = new InstanceManager();
            await expect(
                manager.runAtomicStateUpdate(async (_, writeState) => {
                    await writeState({ sessionId: 'abc', generation: 0 });
                    await writeState({ generation: 1 });
                })
            ).rejects.toThrow('Cannot write more than once');
            const state = await manager.getCurrentState();
            expect(state!.sessionId).toBe('abc');
            expect(state!.generation).toBe(0);
        });
    });
});

describe('SessionPersistence', () => {
    const state: SessionState = { stateId: 'stateId', sessionId: 'abc-123', generation: 0 };

    describe('createSessionRebuildContentMessage', () => {
        it('returns a non-empty base64 string', async () => {
            const result = await createSessionRebuildContentMessage(state);
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
            expect(Buffer.from(result, 'base64').toString('base64')).toBe(result);
        });
    });

    describe('reconstructSessionRebuildContent', () => {
        it('round-trips a SessionState', async () => {
            const compressed = await createSessionRebuildContentMessage(state);
            const result = await reconstructSessionRebuildContent(compressed);
            expect(result).toEqual(state);
        });

        it('throws on non-object JSON payload', async () => {
            const bad = gzipSync(Buffer.from('"just a string"', 'utf8')).toString('base64');
            await expect(reconstructSessionRebuildContent(bad)).rejects.toThrow();
        });

        it('throws on corrupt input', async () => {
            await expect(reconstructSessionRebuildContent('notbase64!!')).rejects.toThrow();
        });
    });

    describe('createSessionRebuildFinalMessage', () => {
        it('includes the initial message and a backtick-wrapped payload on the last line', async () => {
            const initial = 'Shutting down...';
            const result = await createSessionRebuildFinalMessage(initial, state);
            const lines = result.split('\n');
            expect(lines[0]).toBe(initial);
            const last = lines[lines.length - 1];
            expect(last.startsWith('`')).toBe(true);
            expect(last.endsWith('`')).toBe(true);
        });

        it('embeds a payload that decompresses to the original state', async () => {
            const result = await createSessionRebuildFinalMessage('Shutting down...', state);
            const last = result.split('\n').at(-1)!;
            const compressed = last.slice(1, -1);
            const rebuilt = await reconstructSessionRebuildContent(compressed);
            expect(rebuilt).toEqual(state);
        });
    });

    describe('reconstructionFromFinalMessage', () => {
        it('round-trips a SessionState through a final message', async () => {
            const final = await createSessionRebuildFinalMessage('Shutting down...', state);
            const result = await reconstructSessionStateFromFinalMessage(final);
            expect(result).toEqual(state);
        });

        it('throws when no backtick-wrapped payload is present', async () => {
            await expect(reconstructSessionStateFromFinalMessage('Shutting down...\nno payload here')).rejects.toThrow();
        });
    });
});
