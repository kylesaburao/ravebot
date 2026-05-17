import { type Client, Events, type Message, type OmitPartialGroupDMChannel } from "discord.js";
import { type BotConfig } from "../types/BotConfig";
import { type InstanceManager, type SessionState } from "../persistence/SessionPersistence";
import { type EventRegister } from "./types/EventTypes";
import { formatTranslation, getTranslation } from "../../resources/I18n";

type CounterGameRule = (actualNumber: number, currentAuthor: string | undefined, lastState: SessionState['counter']) => boolean;
type CounterState = SessionState['counter'];

type CounterGameDecision =
    | { type: 'success'; nextState: NonNullable<CounterState> }
    | { type: 'failure'; message: string };

type LeaderboardState = NonNullable<SessionState['leaderboard']>;

export enum CounterGameCommand {
    LEADERBOARD = 'LEADERBOARD'
}

export const createLeaderboardFromCounter = (counter: NonNullable<CounterState>): LeaderboardState => ({
    highestCount: counter.lastNumber,
    highestUserId: counter.lastAuthor
});

export const updateLeaderboardOnSuccess = (
    currentLeaderboard: LeaderboardState | undefined,
    nextState: NonNullable<CounterState>
): LeaderboardState => {
    if (!currentLeaderboard || nextState.lastNumber >= currentLeaderboard.highestCount) {
        return createLeaderboardFromCounter(nextState);
    }

    return currentLeaderboard;
};

export const updateLeaderboardOnFailure = (
    currentState: SessionState,
    failure: { userId: string; count: number; timestamp: string }
): LeaderboardState | undefined => {
    const leaderboard = currentState.leaderboard
        ?? (currentState.counter ? createLeaderboardFromCounter(currentState.counter) : undefined);

    return leaderboard ? { ...leaderboard, lastFailure: failure } : undefined;
};

export const formatCounterStats = (state: SessionState | undefined): string => {
    if (!state) {
        return getTranslation('COUNTER_GAME_NO_STATE');
    }

    const currentCounter = state.counter
        ? formatTranslation('COUNTER_GAME_CURRENT_COUNT', {
            count: state.counter.lastNumber,
            userId: state.counter.lastAuthor
        })
        : getTranslation('COUNTER_GAME_NO_ACTIVE_RUN');

    const leaderboard = state.leaderboard
        ? formatTranslation('COUNTER_GAME_HIGHEST_REACHED', {
            count: state.leaderboard.highestCount,
            userId: state.leaderboard.highestUserId
        })
        : getTranslation('COUNTER_GAME_NO_HIGH_SCORE');

    const lastFailure = state.leaderboard?.lastFailure
        ? formatTranslation('COUNTER_GAME_LAST_FAILURE', {
            userId: state.leaderboard.lastFailure.userId,
            count: state.leaderboard.lastFailure.count,
            timestamp: state.leaderboard.lastFailure.timestamp
        })
        : getTranslation('COUNTER_GAME_NO_FAILURES');

    return [currentCounter, leaderboard, lastFailure].join('\n');
};

export const failureRules: readonly { message: string, rule: CounterGameRule }[] = Object.freeze([
    {
        message: getTranslation('COUNTER_GAME_WRONG_USER'),
        rule: (_actualNumber, currentAuthor, lastState) => {
            return !!currentAuthor && currentAuthor === lastState?.lastAuthor;
        }
    },
    {
        message: getTranslation('COUNTER_GAME_WRONG_NUMBER'),
        rule: (actualNumber, _currentAuthor, lastState) => {
            const expectedNumber = lastState
                ? lastState.lastNumber + 1
                : 0;
            return actualNumber !== expectedNumber;
        }
    },
]);

export const parseCounterGameNumber = (messageContent: string): number | undefined => {
    const trimmedContent = messageContent.trim();
    if (!trimmedContent || !Number.isFinite(+trimmedContent) || !Number.isSafeInteger(+trimmedContent)) {
        return undefined;
    }

    return Number(trimmedContent);
};

export const getCounterGameDecision = (
    messageNumber: number,
    currentAuthor: string,
    lastState: CounterState
): CounterGameDecision => {
    const failedRule = failureRules.find(
        rule => rule.rule(messageNumber, currentAuthor, lastState)
    );
    if (failedRule) {
        return { type: 'failure', message: failedRule.message };
    }

    return {
        type: 'success',
        nextState: { lastNumber: messageNumber, lastAuthor: currentAuthor }
    };
};

export const handleCounterGameCommand = async (
    message: OmitPartialGroupDMChannel<Message<boolean>>,
    instanceManager: Pick<InstanceManager, 'getCurrentState'>
): Promise<boolean> => {
    if (message.content.trim() !== CounterGameCommand.LEADERBOARD) {
        return false;
    }

    await message.channel.sendTyping();
    const reply = formatCounterStats(await instanceManager.getCurrentState());
    await message.reply(reply);

    return true;
};

export const onCounterGameMessage = async (message: OmitPartialGroupDMChannel<Message<boolean>>, config: BotConfig, instanceManager: InstanceManager) => {
    if (message.author.bot || message.author.id === config.DISCORD_BOT_ID) {
        return;
    }

    const channel = message.channel;
    if (!channel.isTextBased() || !channel.isSendable() || channel.id !== config.COUNTER_TEXT_CHANNEL_ID) {
        return;
    }

    if (await handleCounterGameCommand(message, instanceManager)) {
        return;
    }

    const messageNumber = parseCounterGameNumber(message.content);
    if (messageNumber === undefined) {
        return;
    }

    await instanceManager.runAtomicStateUpdate(async (currentState, writeState) => {
        if (!currentState) {
            return;
        }

        const decision = getCounterGameDecision(messageNumber, message.author.id, currentState.counter);
        if (decision.type === 'failure') {
            await channel.sendTyping();
            const updatedLeaderboard = updateLeaderboardOnFailure(currentState, {
                userId: message.author.id,
                count: messageNumber,
                timestamp: new Date().toISOString()
            });

            await writeState({ counter: undefined, leaderboard: updatedLeaderboard });
            await message.reply(decision.message);
            return;
        }

        const updatedLeaderboard = updateLeaderboardOnSuccess(currentState.leaderboard, decision.nextState);
        await writeState({ counter: decision.nextState, leaderboard: updatedLeaderboard });
    });
};

export const registerCounterGame: EventRegister = async (client: Client, config: BotConfig, instanceManager: InstanceManager) => {
    client.on(Events.MessageCreate, async (message) => {
        try {
            await onCounterGameMessage(message, config, instanceManager);
        } catch (e) {
            console.error('An error occurred while processing a counter game message:', e);
        }
    });
};
