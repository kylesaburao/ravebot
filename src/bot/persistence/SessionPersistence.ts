import { promisify } from "util";
import { gzip, gunzip } from "zlib";
import { randomUUID } from 'crypto';
import { type InstanceMetadata } from "../types/BotConfig";
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
    private _state: SessionState | undefined;
    private _metadata: InstanceMetadata;
    private _lockChain: Promise<void>;
    private _taskQueues: Map<string, TaskQueue>;
    private _eventBus: Map<string, EventBus>;

    public constructor() {
        this._metadata = {
            isInit: false
        };
        this._lockChain = Promise.resolve();
        this._taskQueues = new Map();
        this._eventBus = new Map();
    }

    registerTaskQueue(queueId: string, concurrency: number, cooldownPeriod: number = 0) {
        if (this._taskQueues.has(queueId)) {
            throw new Error(`Cannot reregister task queue ID \'${queueId}\'`);
        }
        this._taskQueues.set(queueId, new TaskQueue(concurrency, cooldownPeriod));
    }

    getTaskQueue(queueId: string): TaskQueue | undefined {
        return this._taskQueues.get(queueId);
    }

    registerEventBus(eventBusId: string) {
        if (this._eventBus.has(eventBusId)) {
            throw new Error(`Cannot reregister event bus ID \'${eventBusId}\'`);
        }
        this._eventBus.set(eventBusId, new EventBus());
    }

    getEventBus(eventBusId: string) {
        return this._eventBus.get(eventBusId);
    }

    getMetadata(): InstanceMetadata {
        return { ...this._metadata };
    }

    setMetadata(updatedMetadata: Partial<InstanceMetadata>) {
        this._metadata = { ...this._metadata, ...updatedMetadata };
    }

    async getCurrentState(): Promise<SessionState | undefined> {
        const state: SessionState | undefined = this._state
            ? { ...this._state }
            : undefined;
        return state;
    }

    private async setCurrentState(updatedState: Partial<Omit<SessionState, 'stateId'>>) {
        const merged = { ...this._state, ...updatedState };
        if (merged.sessionId === undefined || merged.generation === undefined) {
            throw new Error('sessionId and generation are required when no state exists');
        }
        this._state = { ...(merged as SessionState), stateId: randomUUID() };
    }

    async runAtomicStateUpdate(
        callback: (
            currentState: SessionState | undefined,
            writeState: (update: Partial<Omit<SessionState, 'stateId'>>) => Promise<void>
        ) => Promise<void>
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this._lockChain = this._lockChain.then(async () => {
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
