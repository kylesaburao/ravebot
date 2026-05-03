import { Client, Events } from 'discord.js';
import { onCounterGameMessage } from '../../../src/bot/events/CounterGame';
import { registerDebugHandlers } from '../../../src/bot/events/DebugHandler';
import { InstanceManager } from '../../../src/bot/persistence/SessionPersistence';
import { BotConfig } from '../../../src/bot/types/BotConfig';
import {
    BackupReason,
    EventBackupBusIds,
    EventBusId,
    TaskQueueId,
} from '../../../src/bot/types/Constants';
import { getTranslation } from '../../../src/resources/I18n';

const config: BotConfig = {
    DISCORD_BOT_TOKEN: 'token',
    DISCORD_BOT_ID: 'bot-id',
    SYSTEM_TEXT_CHANNEL_ID: 'system-channel',
    COUNTER_TEXT_CHANNEL_ID: 'counter-channel',
    DEBUG_TEXT_CHANNEL_ID: 'debug-channel',
    initId: 'init',
};

const PRIOR_AUTHOR = 'alice';
const NEW_AUTHOR = 'bob';

// InstanceManager owns its state on static fields, so tests share it unless reset.
const resetInstanceManager = () => {
    const im = InstanceManager as unknown as {
        _state: unknown;
        _metadata: unknown;
        _lockChain: Promise<void>;
        _taskQueues: Map<string, unknown>;
        _eventBus: Map<string, unknown>;
    };
    im._state = undefined;
    im._metadata = undefined;
    im._lockChain = Promise.resolve();
    im._taskQueues = new Map();
    im._eventBus = new Map();
};

type MessageOverrides = {
    content?: string;
    authorId?: string;
    isBot?: boolean;
    channelId?: string;
};

const createMockMessage = (overrides: MessageOverrides = {}) => {
    const reply = jest.fn().mockResolvedValue(undefined);
    const sendTyping = jest.fn().mockResolvedValue(undefined);
    const send = jest.fn().mockResolvedValue(undefined);
    const message = {
        content: overrides.content ?? '',
        author: { id: overrides.authorId ?? 'user-1', bot: overrides.isBot ?? false },
        channel: {
            id: overrides.channelId ?? 'unknown-channel',
            isTextBased: () => true,
            isSendable: () => true,
            sendTyping,
            send,
        },
        reply,
    };
    return { message: message as any, reply, send, sendTyping };
};

const seedState = async (
    instanceManager: InstanceManager,
    counter?: { lastNumber: number; lastAuthor: string }
) => {
    await instanceManager.runAtomicStateUpdate(async (_currentState, writeState) => {
        await writeState({ sessionId: 'session-1', generation: 1, counter });
    });
};

describe('onCounterGameMessage (integration)', () => {
    let instanceManager: InstanceManager;

    beforeEach(async () => {
        resetInstanceManager();
        instanceManager = new InstanceManager();
        await seedState(instanceManager, { lastNumber: 5, lastAuthor: PRIOR_AUTHOR });
    });

    const ignoreCases: { name: string; overrides: MessageOverrides }[] = [
        {
            name: 'messages from bots',
            overrides: { content: '6', isBot: true, channelId: config.COUNTER_TEXT_CHANNEL_ID },
        },
        {
            name: 'messages authored by the bot itself',
            overrides: { content: '6', authorId: config.DISCORD_BOT_ID, channelId: config.COUNTER_TEXT_CHANNEL_ID },
        },
        {
            name: 'messages outside the counter channel',
            overrides: { content: '6', authorId: NEW_AUTHOR, channelId: 'unrelated-channel' },
        },
        {
            name: 'non-numeric content',
            overrides: { content: 'six', authorId: NEW_AUTHOR, channelId: config.COUNTER_TEXT_CHANNEL_ID },
        },
        {
            name: 'non-integer numbers',
            overrides: { content: '6.5', authorId: NEW_AUTHOR, channelId: config.COUNTER_TEXT_CHANNEL_ID },
        },
    ];

    it.each(ignoreCases)('ignores $name', async ({ overrides }) => {
        const { message, reply } = createMockMessage(overrides);
        await onCounterGameMessage(message, config, instanceManager);
        expect(reply).not.toHaveBeenCalled();
        expect((await instanceManager.getCurrentState())?.counter).toEqual({ lastNumber: 5, lastAuthor: PRIOR_AUTHOR });
    });

    it('does nothing when state has not been initialised', async () => {
        resetInstanceManager();
        instanceManager = new InstanceManager();
        const { message, reply } = createMockMessage({
            content: '0',
            authorId: NEW_AUTHOR,
            channelId: config.COUNTER_TEXT_CHANNEL_ID,
        });
        await onCounterGameMessage(message, config, instanceManager);
        expect(reply).not.toHaveBeenCalled();
        expect(await instanceManager.getCurrentState()).toBeUndefined();
    });

    it('records a successful next-number reply', async () => {
        const { message, reply } = createMockMessage({
            content: '6',
            authorId: NEW_AUTHOR,
            channelId: config.COUNTER_TEXT_CHANNEL_ID,
        });
        await onCounterGameMessage(message, config, instanceManager);
        expect(reply).not.toHaveBeenCalled();
        expect((await instanceManager.getCurrentState())?.counter).toEqual({ lastNumber: 6, lastAuthor: NEW_AUTHOR });
    });

    it('resets and replies when the wrong number is sent', async () => {
        const { message, reply, sendTyping } = createMockMessage({
            content: '8',
            authorId: NEW_AUTHOR,
            channelId: config.COUNTER_TEXT_CHANNEL_ID,
        });
        await onCounterGameMessage(message, config, instanceManager);
        expect(sendTyping).toHaveBeenCalledTimes(1);
        expect(reply).toHaveBeenCalledWith(getTranslation('COUNTER_GAME_WRONG_NUMBER'));
        expect((await instanceManager.getCurrentState())?.counter).toBeUndefined();
    });

    it('resets and replies when the same author replies twice', async () => {
        const { message, reply } = createMockMessage({
            content: '6',
            authorId: PRIOR_AUTHOR,
            channelId: config.COUNTER_TEXT_CHANNEL_ID,
        });
        await onCounterGameMessage(message, config, instanceManager);
        expect(reply).toHaveBeenCalledWith(getTranslation('COUNTER_GAME_WRONG_USER'));
        expect((await instanceManager.getCurrentState())?.counter).toBeUndefined();
    });
});

describe('registerDebugHandlers (integration)', () => {
    let instanceManager: InstanceManager;
    let messageHandler: (msg: any) => Promise<void>;
    let scheduleSpy: jest.SpyInstance<Promise<unknown>, [() => Promise<unknown>]>;
    let backupCallback: jest.Mock;

    const setUp = ({ registerBackupBus = true }: { registerBackupBus?: boolean } = {}) => {
        resetInstanceManager();
        instanceManager = new InstanceManager();
        instanceManager.registerTaskQueue(TaskQueueId.DEBUG, 1, 0);

        backupCallback = jest.fn().mockResolvedValue(undefined);
        if (registerBackupBus) {
            instanceManager.registerEventBus(EventBusId.BACKUP_BUS);
            instanceManager.getEventBus(EventBusId.BACKUP_BUS)!.on(EventBackupBusIds.RUN_BACKUP, backupCallback);
        }

        const queue = instanceManager.getTaskQueue(TaskQueueId.DEBUG)!;
        scheduleSpy = jest.spyOn(queue, 'schedule');

        const handlers: Record<string, (msg: any) => Promise<void>> = {};
        const client = {
            on: (event: string, handler: (msg: any) => Promise<void>) => {
                handlers[event] = handler;
            },
        } as unknown as Client;
        registerDebugHandlers(client, config, instanceManager);
        messageHandler = handlers[Events.MessageCreate];
    };

    const dispatch = async (overrides: MessageOverrides) => {
        const fixture = createMockMessage(overrides);
        await messageHandler(fixture.message);
        await Promise.allSettled(scheduleSpy.mock.results.map(r => r.value));
        return fixture;
    };

    beforeEach(() => setUp());

    it('throws at registration when the debug task queue is missing', () => {
        resetInstanceManager();
        const fresh = new InstanceManager();
        const client = { on: jest.fn() } as unknown as Client;
        expect(() => registerDebugHandlers(client, config, fresh)).toThrow('Failed to initialize debug handlers');
    });

    const ignoreCases: { name: string; overrides: MessageOverrides }[] = [
        {
            name: 'messages outside the debug channel',
            overrides: { content: 'HELP', authorId: NEW_AUTHOR, channelId: 'unrelated-channel' },
        },
        {
            name: 'bot-authored messages in the debug channel',
            overrides: { content: 'HELP', authorId: 'someone', isBot: true, channelId: config.DEBUG_TEXT_CHANNEL_ID },
        },
        {
            name: 'messages authored by the bot itself',
            overrides: { content: 'HELP', authorId: config.DISCORD_BOT_ID, channelId: config.DEBUG_TEXT_CHANNEL_ID },
        },
    ];

    it.each(ignoreCases)('ignores $name', async ({ overrides }) => {
        const { reply, sendTyping } = await dispatch(overrides);
        expect(scheduleSpy).not.toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalled();
        expect(sendTyping).not.toHaveBeenCalled();
    });

    it('replies to HELP with all available commands', async () => {
        const { reply, sendTyping } = await dispatch({
            content: 'HELP',
            authorId: NEW_AUTHOR,
            channelId: config.DEBUG_TEXT_CHANNEL_ID,
        });
        expect(sendTyping).toHaveBeenCalledTimes(1);
        const replyArg = String(reply.mock.calls[0]?.[0] ?? '');
        expect(replyArg).toContain(getTranslation('AVAILABLE_COMMANDS'));
        expect(replyArg).toContain('`HELP`');
        expect(replyArg).toContain('`MANUAL_BACKUP`');
        expect(replyArg).toContain('`FORCE_UPDATE`');
    });

    it('notifies the backup event bus on MANUAL_BACKUP', async () => {
        const { reply } = await dispatch({
            content: 'MANUAL_BACKUP',
            authorId: NEW_AUTHOR,
            channelId: config.DEBUG_TEXT_CHANNEL_ID,
        });
        expect(backupCallback).toHaveBeenCalledWith({ reason: BackupReason.MANUAL });
        expect(reply).toHaveBeenCalledWith('MANUAL_BACKUP ran');
    });

    it('reports failure on MANUAL_BACKUP when the backup bus is unavailable', async () => {
        setUp({ registerBackupBus: false });
        const { reply } = await dispatch({
            content: 'MANUAL_BACKUP',
            authorId: NEW_AUTHOR,
            channelId: config.DEBUG_TEXT_CHANNEL_ID,
        });
        expect(backupCallback).not.toHaveBeenCalled();
        expect(reply).toHaveBeenCalledWith('Unable to run MANUAL_BACKUP');
    });

    it('rewrites existing state on FORCE_UPDATE', async () => {
        await seedState(instanceManager, { lastNumber: 7, lastAuthor: PRIOR_AUTHOR });
        const stateBefore = await instanceManager.getCurrentState();
        const { reply } = await dispatch({
            content: 'FORCE_UPDATE',
            authorId: NEW_AUTHOR,
            channelId: config.DEBUG_TEXT_CHANNEL_ID,
        });
        expect(reply).toHaveBeenCalledWith('FORCE_UPDATE ran');
        const stateAfter = await instanceManager.getCurrentState();
        expect(stateAfter?.counter).toEqual(stateBefore?.counter);
        // setCurrentState rerolls stateId, so the write must have actually run.
        expect(stateAfter?.stateId).not.toEqual(stateBefore?.stateId);
    });

    it('does nothing on FORCE_UPDATE when no state exists', async () => {
        const { reply } = await dispatch({
            content: 'FORCE_UPDATE',
            authorId: NEW_AUTHOR,
            channelId: config.DEBUG_TEXT_CHANNEL_ID,
        });
        expect(reply).not.toHaveBeenCalled();
    });

    it('replies with Unknown command for unrecognised content', async () => {
        const { reply, send, sendTyping } = await dispatch({
            content: 'NOT_A_COMMAND',
            authorId: NEW_AUTHOR,
            channelId: config.DEBUG_TEXT_CHANNEL_ID,
        });
        expect(sendTyping).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith("Unknown command 'NOT_A_COMMAND'. See `HELP`.");
        expect(reply).not.toHaveBeenCalled();
    });
});
