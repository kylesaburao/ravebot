import { type Client } from "discord.js";
import { type BotConfig } from "../../types/BotConfig";
import { type InstanceManager } from "../../persistence/SessionPersistence";

export type EventRegister = (client: Client, config: BotConfig, instanceManager: InstanceManager) => void;
