import { promisify } from "util";
import { gzip, gunzip } from "zlib";
import { randomUUID } from 'crypto';
import { InstanceMetadata } from "../types/BotConfig";
import { TaskQueue } from "../../utils/TaskQueue";
import { EventBus } from "../../utils/EventBus";

const asyncGzip = promisify(gzip);
const asyncGunzip = promisify(gunzip);
const UNKNOWN_VALUE = '';
export const REBUILD_STATE_HEADER = `\`IN-MEMORY STATE:\``;

export interface SessionState {
    stateId: string;
    sessionId: string;
    generation: number;
    counter?: {
        lastNumber: number;
        lastAuthor: string;
    }
}

export class InstanceManager {
    private static _state: SessionState | undefined;
    private static _metadata: InstanceMetadata;
    private static _lockChain: Promise<void> = Promise.resolve();
    private static _taskQueues: Map<string, TaskQueue> = new Map();
    private static _eventBus: Map<string, EventBus> = new Map();

    public constructor() {
        if (!InstanceManager._metadata) {
            InstanceManager._metadata = {
                isInit: false
            };
        }
    }

    registerTaskQueue(queueId: string, concurrency: number, cooldownPeriod: number = 0) {
        if (InstanceManager._taskQueues.has(queueId)) {
            throw new Error(`Cannot reregister task queue ID \'${queueId}\'`);
        }
        InstanceManager._taskQueues.set(queueId, new TaskQueue(concurrency, cooldownPeriod));
    }

    getTaskQueue(queueId: string): TaskQueue | undefined {
        return InstanceManager._taskQueues.get(queueId);
    }

    registerEventBus(eventBusId: string) {
        if (InstanceManager._eventBus.has(eventBusId)) {
            throw new Error(`Cannot reregister event bus ID \'${eventBusId}\'`);
        }
        InstanceManager._eventBus.set(eventBusId, new EventBus());
    }

    getEventBus(eventBusId: string) {
        return InstanceManager._eventBus.get(eventBusId);
    }

    getMetadata(): InstanceMetadata {
        return { ...InstanceManager._metadata };
    }

    setMetadata(updatedMetadata: Partial<InstanceMetadata>) {
        InstanceManager._metadata = { ...InstanceManager._metadata, ...updatedMetadata };
    }

    async getCurrentState(): Promise<SessionState | undefined> {
        const state: SessionState | undefined = InstanceManager._state
            ? { ...InstanceManager._state }
            : undefined;
        return Promise.resolve(state);
    }

    private async setCurrentState(updatedState: Partial<Omit<SessionState, 'stateId'>>) {
        const merged = { ...InstanceManager._state, ...updatedState };
        if (merged.sessionId === undefined || merged.generation === undefined) {
            throw new Error('sessionId and generation are required when no state exists');
        }
        InstanceManager._state = { ...(merged as SessionState), stateId: randomUUID() };
    }

    async runAtomicStateUpdate(
        callback: (
            currentState: SessionState | undefined,
            writeState: (update: Partial<Omit<SessionState, 'stateId'>>) => Promise<void>
        ) => Promise<void>
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            InstanceManager._lockChain = InstanceManager._lockChain.then(async () => {
                try {
                    const currentState = await this.getCurrentState();
                    let didWriteOccur = false;
                    await callback(currentState, async (update) => {
                        if (!didWriteOccur) {
                            didWriteOccur = true;
                            await this.setCurrentState(update);
                        } else {
                            throw new Error('Cannot write more than once');
                        }
                    });
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    }
}

export const createSessionRebuildContentMessage = async (content: SessionState): Promise<string> => {
    const message = JSON.stringify(content);
    const compressed = await asyncGzip(Buffer.from(message, 'utf-8'));
    return compressed.toString('base64');
};

export const createSessionRebuildFinalMessage = async (initialMessage: string, content: SessionState): Promise<string> => {
    const contentMessage = await createSessionRebuildContentMessage(content);

    const lines: string[] = [
        initialMessage,
        '',
        REBUILD_STATE_HEADER,
        `\`${contentMessage}\``
    ];
    return lines.join('\n');
};

export const reconstructSessionRebuildContent = async (compressedState: string): Promise<SessionState> => {
    const decompressed = await asyncGunzip(Buffer.from(compressedState, 'base64'));
    const representation = decompressed.toString('utf-8');
    const rebuiltContent: SessionState = JSON.parse(representation);

    if (!rebuiltContent || typeof rebuiltContent !== 'object') {
        throw new Error('Invalid compressed state');
    }

    if (!rebuiltContent.sessionId) {
        rebuiltContent.sessionId = UNKNOWN_VALUE;
    }
    if (!rebuiltContent.generation) {
        rebuiltContent.generation = 0;
    }
    if (!rebuiltContent.stateId) {
        rebuiltContent.stateId = randomUUID();
    }

    return rebuiltContent;
};

export const reconstructSessionStateFromFinalMessage = async (finalMessage: string): Promise<SessionState> => {
    const lines = finalMessage.split('\n');
    const payloadLine = lines.map(l => l.trim()).reverse().find(l => l.startsWith('`') && l.endsWith('`'));

    if (!payloadLine) {
        throw new Error('No compressed state found in final message');
    }

    const compressedState = payloadLine.slice(1, -1);
    return reconstructSessionRebuildContent(compressedState);
};
