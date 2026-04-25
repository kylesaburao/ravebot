import { promisify } from "util";
import { gzip, gunzip } from "zlib";

const asyncGzip = promisify(gzip);
const asyncGunzip = promisify(gunzip);
const UNKNOWN_VALUE = '';
export const REBUILD_STATE_HEADER = `\`IN-MEMORY STATE:\``;

export interface SessionState {
    sessionId: string;
    generation: number;
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
