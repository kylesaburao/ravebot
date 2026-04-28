import { Client, Events } from "discord.js"
import { BotConfig } from "../types/BotConfig";
import { InstanceManager } from "../persistence/SessionPersistence";
import { EventRegister } from "./types/EventTypes";

export const registerCounterGame: EventRegister = (client: Client, config: BotConfig, instanceManager: InstanceManager) => {
    client.on(Events.MessageCreate, async (message) => {
        if (!message.author.bot && message.author.id !== config.DISCORD_BOT_ID) {
            const channel = message.channel;

            // Counting game
            if (channel.isTextBased() && channel.isSendable() && channel.id === config.COUNTER_TEXT_CHANNEL_ID) {
                const messageContent = message.content.trim();
                if (messageContent && Number.isFinite(+messageContent) && Number.isSafeInteger(+messageContent)) {
                    const messageNumber = Number(messageContent);
                    await instanceManager.runAtomicStateUpdate(async (currentState, writeState) => {
                        if (!currentState) return;

                        const failureRules = [
                            {
                                message: 'You replied with the wrong number. Restarting from 0.',
                                rule: () => {
                                    const expectedNumber = currentState.counter ? currentState.counter.lastNumber + 1 : 0;
                                    return messageNumber !== expectedNumber;
                                }
                            },
                            {
                                message: 'Someone else must try. Restarting from 0.',
                                rule: () => currentState.counter?.lastAuthor === message.author.id
                            },
                        ];

                        const failedRule = failureRules.find(rule => rule.rule());
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
    });
};
