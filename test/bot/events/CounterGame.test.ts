import { CounterGameCommand, createLeaderboardFromCounter, failureRules, formatCounterStats, getCounterGameDecision, handleCounterGameCommand, parseCounterGameNumber, updateLeaderboardOnFailure, updateLeaderboardOnSuccess } from "../../../src/bot/events/CounterGame";
import { type InstanceManager, type SessionState } from "../../../src/bot/persistence/SessionPersistence";

type CounterState = SessionState['counter'];

const lastState = (lastNumber: number, lastAuthor: string): NonNullable<CounterState> => ({ lastNumber, lastAuthor });
type CommandMessage = Parameters<typeof handleCounterGameCommand>[0];

const createCommandMessage = (content: string) => {
    const sendTyping = jest.fn().mockResolvedValue(undefined);
    const reply = jest.fn().mockResolvedValue(undefined);
    const message = {
        content,
        channel: { sendTyping },
        reply
    } as unknown as CommandMessage;

    return { message, reply, sendTyping };
};

describe('CounterGame failureRules', () => {
    it('exposes exactly the two known rules in order', () => {
        expect(failureRules).toHaveLength(2);
    });

    describe('wrong-user rule (index 0)', () => {
        const { rule } = failureRules[0];

        it('passes when there is no prior state', () => {
            expect(rule(0, 'alice', undefined)).toBe(false);
        });

        it('passes when the current author differs from the last author', () => {
            expect(rule(6, 'alice', lastState(5, 'bob'))).toBe(false);
        });

        it('fails when the current author matches the last author', () => {
            expect(rule(6, 'bob', lastState(5, 'bob'))).toBe(true);
        });

        it('passes when the current author is missing, even if last author is set', () => {
            expect(rule(6, undefined, lastState(5, 'bob'))).toBe(false);
        });

        it('does not consider the number', () => {
            expect(rule(999, 'bob', lastState(5, 'bob'))).toBe(true);
            expect(rule(999, 'alice', lastState(5, 'bob'))).toBe(false);
        });
    });

    describe('wrong-number rule (index 1)', () => {
        const { rule } = failureRules[1];

        it('passes when starting from 0 with no prior state', () => {
            expect(rule(0, 'alice', undefined)).toBe(false);
        });

        it('fails when the first number is not 0', () => {
            expect(rule(1, 'alice', undefined)).toBe(true);
            expect(rule(-1, 'alice', undefined)).toBe(true);
            expect(rule(42, 'alice', undefined)).toBe(true);
        });

        it('passes when the number is exactly lastNumber + 1', () => {
            expect(rule(6, 'alice', lastState(5, 'bob'))).toBe(false);
        });

        it('fails when the number skips, repeats, or goes backwards', () => {
            expect(rule(7, 'alice', lastState(5, 'bob'))).toBe(true);
            expect(rule(5, 'alice', lastState(5, 'bob'))).toBe(true);
            expect(rule(4, 'alice', lastState(5, 'bob'))).toBe(true);
        });

        it('does not consider the author', () => {
            expect(rule(6, undefined, lastState(5, 'bob'))).toBe(false);
            expect(rule(6, 'bob', lastState(5, 'bob'))).toBe(false);
        });
    });
});

describe('CounterGame decisions', () => {
    it('parses safe integer message content', () => {
        expect(parseCounterGameNumber(' 6 ')).toBe(6);
        expect(parseCounterGameNumber('6.5')).toBeUndefined();
        expect(parseCounterGameNumber('six')).toBeUndefined();
        expect(parseCounterGameNumber('')).toBeUndefined();
    });

    it('returns failure with the matching rule message', () => {
        expect(getCounterGameDecision(6, 'bob', lastState(5, 'bob'))).toEqual({
            type: 'failure',
            message: failureRules[0].message
        });
    });

    it('returns the next counter state for a valid count', () => {
        expect(getCounterGameDecision(6, 'alice', lastState(5, 'bob'))).toEqual({
            type: 'success',
            nextState: { lastNumber: 6, lastAuthor: 'alice' }
        });
    });
});

describe('CounterGame commands', () => {
    it('handles the leaderboard command', async () => {
        const state: SessionState = {
            stateId: 'state',
            sessionId: 'session',
            generation: 1,
            counter: { lastNumber: 7, lastAuthor: 'alice' }
        };
        const instanceManager = {
            getCurrentState: jest.fn().mockResolvedValue(state)
        } as unknown as Pick<InstanceManager, 'getCurrentState'>;
        const { message, reply, sendTyping } = createCommandMessage(` ${CounterGameCommand.LEADERBOARD} `);

        await expect(handleCounterGameCommand(message, instanceManager)).resolves.toBe(true);

        expect(sendTyping).toHaveBeenCalledTimes(1);
        expect(instanceManager.getCurrentState).toHaveBeenCalledTimes(1);
        expect(reply).toHaveBeenCalledWith([
            'Current count: 7 by <@alice>',
            'No high score recorded yet.',
            'No failures recorded yet.'
        ].join('\n'));
    });

    it('ignores non-command content', async () => {
        const instanceManager = {
            getCurrentState: jest.fn()
        } as unknown as Pick<InstanceManager, 'getCurrentState'>;
        const { message, reply, sendTyping } = createCommandMessage('6');

        await expect(handleCounterGameCommand(message, instanceManager)).resolves.toBe(false);

        expect(sendTyping).not.toHaveBeenCalled();
        expect(instanceManager.getCurrentState).not.toHaveBeenCalled();
        expect(reply).not.toHaveBeenCalled();
    });
});

describe('CounterGame leaderboard', () => {
    it('creates leaderboard state from a counter', () => {
        expect(createLeaderboardFromCounter(lastState(5, 'bob'))).toEqual({
            highestCount: 5,
            highestUserId: 'bob'
        });
    });

    it('updates leaderboard when a new high score is reached', () => {
        expect(updateLeaderboardOnSuccess({
            highestCount: 5,
            highestUserId: 'bob',
            lastFailure: {
                userId: 'carol',
                count: 4,
                timestamp: '2026-05-17T00:00:00.000Z'
            }
        }, lastState(6, 'alice'))).toEqual({
            highestCount: 6,
            highestUserId: 'alice'
        });
    });

    it('updates the record holder when the high score is matched', () => {
        expect(updateLeaderboardOnSuccess({ highestCount: 8, highestUserId: 'bob' }, lastState(8, 'alice'))).toEqual({
            highestCount: 8,
            highestUserId: 'alice'
        });
    });

    it('does not lower the existing high score when a lower number is reached', () => {
        expect(updateLeaderboardOnSuccess({ highestCount: 8, highestUserId: 'bob' }, lastState(6, 'alice'))).toEqual({
            highestCount: 8,
            highestUserId: 'bob'
        });
    });

    it('attaches failure metadata to an existing leaderboard', () => {
        const currentState: SessionState = {
            stateId: 'state',
            sessionId: 'session',
            generation: 0,
            counter: lastState(5, 'bob'),
            leaderboard: { highestCount: 5, highestUserId: 'bob' }
        };

        expect(updateLeaderboardOnFailure(currentState, {
            userId: 'alice',
            count: 6,
            timestamp: '2026-05-17T00:00:00.000Z'
        })).toEqual({
            highestCount: 5,
            highestUserId: 'bob',
            lastFailure: {
                userId: 'alice',
                count: 6,
                timestamp: '2026-05-17T00:00:00.000Z'
            }
        });
    });

    it('does not fabricate leaderboard state on failure when no counter source exists', () => {
        const currentState: SessionState = {
            stateId: 'state',
            sessionId: 'session',
            generation: 0
        };

        expect(updateLeaderboardOnFailure(currentState, {
            userId: 'alice',
            count: 1,
            timestamp: '2026-05-17T00:00:00.000Z'
        })).toBeUndefined();
    });
});

describe('CounterGame leaderboard formatting', () => {
    it('renders a no-state message when no session state exists', () => {
        expect(formatCounterStats(undefined)).toBe('No counter session state is available.');
    });

    it('renders current counter state without leaderboard data', () => {
        const state: SessionState = {
            stateId: 'state',
            sessionId: 'session',
            generation: 1,
            counter: { lastNumber: 7, lastAuthor: 'alice' }
        };

        expect(formatCounterStats(state)).toBe([
            'Current count: 7 by <@alice>',
            'No high score recorded yet.',
            'No failures recorded yet.'
        ].join('\n'));
    });

    it('renders leaderboard and last failure when present', () => {
        const state: SessionState = {
            stateId: 'state',
            sessionId: 'session',
            generation: 2,
            counter: { lastNumber: 7, lastAuthor: 'alice' },
            leaderboard: {
                highestCount: 10,
                highestUserId: 'bob',
                lastFailure: {
                    userId: 'alice',
                    count: 8,
                    timestamp: '2026-05-17T12:34:56.000Z'
                }
            }
        };

        expect(formatCounterStats(state)).toBe([
            'Current count: 7 by <@alice>',
            'Highest reached: 10 by <@bob>',
            'Last failure: <@alice> at 8 on 2026-05-17T12:34:56.000Z'
        ].join('\n'));
    });
});
