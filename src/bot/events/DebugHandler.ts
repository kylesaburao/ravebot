import { Client, Events, Message, OmitPartialGroupDMChannel } from "discord.js";
import { EventRegister } from "./types/EventTypes";
import { BotConfig } from "../types/BotConfig";
import { InstanceManager } from "../persistence/SessionPersistence";
import { BackupReason, EventBackupBusIds, EventBusId } from "../types/Constants";

export const registerDebugHandlers: EventRegister = (client: Client, config: BotConfig, instanceManager: InstanceManager) => {
    const actions = {
        'HELP': async (message: OmitPartialGroupDMChannel<Message<boolean>>) => {
            const availableCommands = Object.keys(actions);
            const response = [
                'Available commands:',
                ...availableCommands.map(command => `- \`${command}\``)
            ].join('\n');
            await message.reply(response);
        },
        'MANUAL_BACKUP': async (message: OmitPartialGroupDMChannel<Message<boolean>>) => {
            const eventBus = instanceManager.getEventBus(EventBusId.BACKUP_BUS);
            if (eventBus) {
                await eventBus.notify(EventBackupBusIds.RUN_BACKUP, { reason: BackupReason.MANUAL });
                await message.reply('MANUAL_BACKUP ran');
            } else {
                await message.reply('Unable to run MANUAL_BACKUP');
            }
        },
        'FORCE_UPDATE': async (message: OmitPartialGroupDMChannel<Message<boolean>>) => {
            await instanceManager.runAtomicStateUpdate(async (currentState, writeState) => {
                if (currentState) {
                    await writeState(currentState);
                    await message.reply('FORCE_UPDATE ran');
                }
            });
        }
    };

    client.on(Events.MessageCreate, async (message) => {
        if (!message.author.bot && message.author.id !== config.DISCORD_BOT_ID) {
            const channel = message.channel;
            if (channel.id === config.DEBUG_TEXT_CHANNEL_ID) {
                const content = message.content;

                if (content in actions) {
                    const action = actions[content as keyof typeof actions];
                    if (action) {
                        await channel.sendTyping();
                        await action(message);
                    }
                } else {
                    await channel.sendTyping();
                    await channel.send(`Unknown command \'${content}\'. See \`HELP\`.`);
                }
            }
        }
    });
};
