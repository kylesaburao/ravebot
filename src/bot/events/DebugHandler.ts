import { type Client, Events, type Message, type OmitPartialGroupDMChannel } from "discord.js";
import { type EventRegister } from "./types/EventTypes";
import { type BotConfig } from "../types/BotConfig";
import { type InstanceManager } from "../persistence/SessionPersistence";
import { BackupReason, EventBackupBusIds, EventBusId } from "../types/Constants";
import { getTranslation } from "../../resources/I18n";
import { TaskQueue } from "../../utils/TaskQueue";

type DebugActionHandler = (message: OmitPartialGroupDMChannel<Message<boolean>>, instanceManager: InstanceManager) => Promise<void>;

enum DebugActionCommand {
    HELP = 'HELP',
    MANUAL_BACKUP = 'MANUAL_BACKUP',
    FORCE_UPDATE = 'FORCE_UPDATE'
}

const debugActions: Record<string, DebugActionHandler | undefined> = {
    [DebugActionCommand.HELP]: async (message) => {
        const availableCommands = Object.keys(debugActions);
        const response = [
            getTranslation('AVAILABLE_COMMANDS'),
            ...availableCommands.map(command => `- \`${command}\``)
        ].join('\n');
        await message.reply(response);
    },
    [DebugActionCommand.MANUAL_BACKUP]: async (message, instanceManager) => {
        const eventBus = instanceManager.getEventBus(EventBusId.BACKUP_BUS);
        if (eventBus) {
            await eventBus.notify(EventBackupBusIds.RUN_BACKUP, { reason: BackupReason.MANUAL });
            await message.reply(`${DebugActionCommand.MANUAL_BACKUP} ran`);
        } else {
            await message.reply(`Unable to run ${DebugActionCommand.MANUAL_BACKUP}`);
        }
    },
    [DebugActionCommand.FORCE_UPDATE]: async (message, instanceManager) => {
        await instanceManager.runAtomicStateUpdate(async (currentState, writeState) => {
            if (currentState) {
                await writeState(currentState);
                await message.reply(`${DebugActionCommand.FORCE_UPDATE} ran`);
            }
        });
    }
};

export const registerDebugHandlers: EventRegister = (client: Client, config: BotConfig, instanceManager: InstanceManager) => {
    const debugTaskQueue = new TaskQueue(1, 500);

    client.on(Events.MessageCreate, async (message) => {
        const channel = message.channel;
        if (!message.author.bot && message.author.id !== config.DISCORD_BOT_ID && channel.id === config.DEBUG_TEXT_CHANNEL_ID) {
            debugTaskQueue.schedule(async () => {
                const { content } = message;
                const action = debugActions[content];

                if (action) {
                    await channel.sendTyping();
                    await action(message, instanceManager);
                } else {
                    await channel.sendTyping();
                    await channel.send(`Unknown command \'${content}\'. See \`HELP\`.`);
                }
            });
        }
    });
};
