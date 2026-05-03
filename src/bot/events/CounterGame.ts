import { Client, Events, Message, OmitPartialGroupDMChannel } from "discord.js"
import { BotConfig } from "../types/BotConfig";
import { InstanceManager, SessionState } from "../persistence/SessionPersistence";
import { EventRegister } from "./types/EventTypes";
import { getTranslation } from "../../resources/I18n";

type CounterGameRule = (actualNumber: number, currentAuthor: string | undefined, lastState: SessionState['counter']) => boolean;

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

export const onCounterGameMessage = async (message: OmitPartialGroupDMChannel<Message<boolean>>, config: BotConfig, instanceManager: InstanceManager) => {
    if (!message.author.bot && message.author.id !== config.DISCORD_BOT_ID) {
        const channel = message.channel;

        // Counting game
        if (channel.isTextBased() && channel.isSendable() && channel.id === config.COUNTER_TEXT_CHANNEL_ID) {
            const messageContent = message.content.trim();
            if (messageContent && Number.isFinite(+messageContent) && Number.isSafeInteger(+messageContent)) {
                const messageNumber = Number(messageContent);
                await instanceManager.runAtomicStateUpdate(async (currentState, writeState) => {
                    if (!currentState) {
                        return;
                    }

                    const failedRule = failureRules.find(
                        rule => rule.rule(messageNumber, message.author.id, currentState.counter)
                    );
                    if (failedRule) {
                        await channel.sendTyping();
                        await writeState({ counter: undefined });
                        await message.reply(failedRule.message);
                        return;
                    }
                    await writeState({ counter: { lastNumber: messageNumber, lastAuthor: message.author.id } });
                });
            }
        }
    }
};

export const registerCounterGame: EventRegister = async (client: Client, config: BotConfig, instanceManager: InstanceManager) => {
    client.on(Events.MessageCreate, async (message) => {
        await onCounterGameMessage(message, config, instanceManager);
    });
};
