import { BackupReason } from "../types/Constants";
import { createSessionRebuildFinalMessage, type InstanceManager } from "../persistence/SessionPersistence";
import { getCurrentTime } from "../utils/TimeUtils";

interface PersistSessionStateOptions {
    reason: string;
    lastPersistedStateId?: string;
    instanceManager: Pick<InstanceManager, 'getCurrentState'>;
    logMessage: (message: string) => Promise<void>;
    getTime?: () => string;
}

interface PersistSessionStateResult {
    currentStateId?: string;
    didRun: boolean;
}

export const persistSessionState = async ({
    reason,
    lastPersistedStateId,
    instanceManager,
    logMessage,
    getTime = getCurrentTime
}: PersistSessionStateOptions): Promise<PersistSessionStateResult | undefined> => {
    try {
        const shutdownMessage = `${reason} @ ${getTime()}`;
        const currentState = await instanceManager.getCurrentState();
        const currentStateId = currentState ? currentState.stateId : undefined;
        let didRun = false;

        if (currentState) {
            const isUnchangedAutomaticBackup = reason === BackupReason.AUTOMATIC
                && !!lastPersistedStateId
                && currentState.stateId === lastPersistedStateId;

            if (reason === BackupReason.MANUAL || !isUnchangedAutomaticBackup) {
                const closingMessage = await createSessionRebuildFinalMessage(
                    shutdownMessage,
                    currentState
                );
                await logMessage(closingMessage);
                didRun = true;
            }
        } else if (reason === BackupReason.SHUTDOWN) {
            await logMessage(shutdownMessage);
            didRun = true;
        }

        return { currentStateId, didRun };
    } catch (error) {
        console.error('Failed to send shutdown message:', error);
    }
};
