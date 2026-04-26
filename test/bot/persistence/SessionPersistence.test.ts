import { gzipSync } from 'zlib';
import type { SessionState } from '../../../src/bot/persistence/SessionPersistence';
import {
    createSessionRebuildContentMessage,
    createSessionRebuildFinalMessage,
    reconstructSessionRebuildContent,
    reconstructSessionStateFromFinalMessage,
} from '../../../src/bot/persistence/SessionPersistence';

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
