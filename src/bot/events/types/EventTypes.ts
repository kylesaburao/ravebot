import { Client } from "discord.js";
import { BotConfig } from "../../types/BotConfig";
import { InstanceManager } from "../../persistence/SessionPersistence";

export type EventRegister = (client: Client, config: BotConfig, instanceManager: InstanceManager) => void;
