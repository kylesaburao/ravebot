import { type Client, Events, type Message, type OmitPartialGroupDMChannel } from "discord.js";
import { type BotConfig } from "../types/BotConfig";
import { type InstanceManager, type SessionState } from "../persistence/SessionPersistence";
import { type EventRegister } from "./types/EventTypes";
import { getTranslation } from "../../resources/I18n";

type CounterGameRule = (actualNumber: number, currentAuthor: string | undefined, lastState: SessionState['counter']) => boolean;
type CounterState = SessionState['counter'];

type CounterGameDecision =
    | { type: 'success'; nextState: NonNullable<CounterState> }
    | { type: 'failure'; message: string };

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

export const onCounterGameMessage = async (message: OmitPartialGroupDMChannel<Message<boolean>>, config: BotConfig, instanceManager: InstanceManager) => {
    if (!message.author.bot && message.author.id !== config.DISCORD_BOT_ID) {
        const channel = message.channel;

        // Counting game
        if (channel.isTextBased() && channel.isSendable() && channel.id === config.COUNTER_TEXT_CHANNEL_ID) {
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
                    await writeState({ counter: undefined });
                    await message.reply(decision.message);
                    return;
                }

                await writeState({ counter: decision.nextState });
            });
        }
    }
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
