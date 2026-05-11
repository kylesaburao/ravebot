import { createSessionRebuildFinalMessage, InstanceManager, type SessionState } from "../../../src/bot/persistence/SessionPersistence";
import { findRecoveryContent, recoverSessionState } from "../../../src/bot/services/RecoveryService";

const botId = 'bot-id';

interface TestRecoveryMessage {
    id: string;
    content: string;
    createdTimestamp: number;
    author: {
        bot: boolean;
        id: string;
    };
}

const createCollection = (messages: TestRecoveryMessage[]) => ({
    size: messages.length,
    values: function* () {
        yield* messages;
    }
});

const createMessage = (
    overrides: Partial<Omit<TestRecoveryMessage, 'author'>> & { author?: Partial<TestRecoveryMessage['author']> } = {}
): TestRecoveryMessage => ({
    id: overrides.id ?? 'message-id',
    content: overrides.content ?? 'hello',
    createdTimestamp: overrides.createdTimestamp ?? 1,
    author: {
        bot: overrides.author?.bot ?? true,
        id: overrides.author?.id ?? botId
    }
});

type RecoverSessionStateOptions = Parameters<typeof recoverSessionState>[0];

describe('findRecoveryContent', () => {
    it('finds a valid rebuild message from fetched channel pages', async () => {
        const state: SessionState = { stateId: 'state-1', sessionId: 'session-1', generation: 1 };
        const finalMessage = await createSessionRebuildFinalMessage('Shutdown backup @ now', state);
        const channel = {
            messages: {
                fetch: jest.fn().mockResolvedValue(createCollection([
                    createMessage({ id: 'older', createdTimestamp: 1, content: 'noise' }),
                    createMessage({ id: 'newer', createdTimestamp: 2, content: finalMessage })
                ]))
            }
        };

        await expect(findRecoveryContent({
            channel,
            botId,
            logMessage: jest.fn().mockResolvedValue(undefined),
            retryDelayMs: 0
        })).resolves.toBe(finalMessage);
    });

    it('stops when no messages remain', async () => {
        const fetch = jest.fn().mockResolvedValue(createCollection([]));

        await expect(findRecoveryContent({
            channel: { messages: { fetch } },
            botId,
            logMessage: jest.fn().mockResolvedValue(undefined),
            retryDelayMs: 0
        })).resolves.toBeUndefined();

        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('passes the oldest message ID from page N as the before cursor on page N+1', async () => {
        const fetch = jest.fn()
            .mockResolvedValueOnce(createCollection([
                createMessage({ id: 'newest', createdTimestamp: 2, content: 'noise' }),
                createMessage({ id: 'oldest', createdTimestamp: 1, content: 'noise' }),
            ]))
            .mockResolvedValueOnce(createCollection([]));

        await findRecoveryContent({
            channel: { messages: { fetch } },
            botId,
            logMessage: jest.fn().mockResolvedValue(undefined),
            retryDelayMs: 0
        });

        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenNthCalledWith(2, expect.objectContaining({ before: 'oldest' }));
    });

    it('ignores messages from non-bot authors or the wrong bot ID', async () => {
        const state: SessionState = { stateId: 'state-1', sessionId: 'session-1', generation: 1 };
        const finalMessage = await createSessionRebuildFinalMessage('Shutdown backup @ now', state);
        const channel = {
            messages: {
                fetch: jest.fn()
                    .mockResolvedValueOnce(createCollection([
                        createMessage({ content: finalMessage, author: { bot: false, id: botId } }),
                        createMessage({ content: finalMessage, author: { bot: true, id: 'someone-else' } })
                    ]))
                    .mockResolvedValueOnce(createCollection([]))
            }
        };

        await expect(findRecoveryContent({
            channel,
            botId,
            logMessage: jest.fn().mockResolvedValue(undefined),
            retryDelayMs: 0
        })).resolves.toBeUndefined();
    });
});

describe('recoverSessionState', () => {
    it('handles channel fetch failures without throwing', async () => {
        const client = {
            channels: {
                fetch: jest.fn().mockRejectedValue(new Error('discord unavailable'))
            }
        };
        const instanceManager = {
            runAtomicStateUpdate: jest.fn()
        };
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(recoverSessionState({
            client: client as unknown as RecoverSessionStateOptions['client'],
            config: { SYSTEM_TEXT_CHANNEL_ID: 'system-channel', DISCORD_BOT_ID: botId },
            instanceManager: instanceManager as unknown as RecoverSessionStateOptions['instanceManager'],
            logMessage: jest.fn().mockResolvedValue(undefined),
            retryDelayMs: 0
        })).resolves.toBeUndefined();

        expect(instanceManager.runAtomicStateUpdate).not.toHaveBeenCalled();
        expect(errorSpy).toHaveBeenCalledWith('Failed to recover session state:', expect.any(Error));
        errorSpy.mockRestore();
    });

    it('writes the recovered state to instanceManager when a backup is found', async () => {
        const originalState: SessionState = { stateId: 'state-1', sessionId: 'session-1', generation: 7, counter: { lastNumber: 42, lastAuthor: 'alice' } };
        const finalMessage = await createSessionRebuildFinalMessage('Shutdown @ now', originalState);
        const client = {
            channels: {
                fetch: jest.fn().mockResolvedValue({
                    isTextBased: () => true,
                    messages: {
                        fetch: jest.fn().mockResolvedValue(createCollection([
                            createMessage({ content: finalMessage })
                        ]))
                    }
                })
            }
        };

        const instanceManager = new InstanceManager();
        await recoverSessionState({
            client: client as unknown as RecoverSessionStateOptions['client'],
            config: { SYSTEM_TEXT_CHANNEL_ID: 'system-channel', DISCORD_BOT_ID: botId },
            instanceManager,
            logMessage: jest.fn().mockResolvedValue(undefined),
            retryDelayMs: 0
        });

        const recovered = await instanceManager.getCurrentState();
        expect(recovered).toMatchObject({
            sessionId: originalState.sessionId,
            generation: originalState.generation,
            counter: originalState.counter
        });
    });

    it('handles corrupt rebuild payloads without throwing', async () => {
        const corruptFinalMessage = [
            'Shutdown backup @ now',
            '',
            '`IN-MEMORY STATE:`',
            '`notbase64!!`'
        ].join('\n');
        const client = {
            channels: {
                fetch: jest.fn().mockResolvedValue({
                    isTextBased: () => true,
                    messages: {
                        fetch: jest.fn().mockResolvedValue(createCollection([
                            createMessage({ content: corruptFinalMessage })
                        ]))
                    }
                })
            }
        };
        const instanceManager = {
            runAtomicStateUpdate: jest.fn()
        };
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        await expect(recoverSessionState({
            client: client as unknown as RecoverSessionStateOptions['client'],
            config: { SYSTEM_TEXT_CHANNEL_ID: 'system-channel', DISCORD_BOT_ID: botId },
            instanceManager: instanceManager as unknown as RecoverSessionStateOptions['instanceManager'],
            logMessage: jest.fn().mockResolvedValue(undefined),
            retryDelayMs: 0
        })).resolves.toBeUndefined();

        expect(instanceManager.runAtomicStateUpdate).not.toHaveBeenCalled();
        errorSpy.mockRestore();
    });
});
