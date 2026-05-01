export enum TaskQueueId {
    SYNCHRONOUS = 'SYNCHRONOUS',
    BACKUP = 'BACKUP',
    DEBUG = 'DEBUG'
}

export enum EventBusId {
    BACKUP_BUS = 'BACKUP_BUS'
}

export enum EventBackupBusIds {
    RUN_BACKUP = 'RUN_BACKUP'
}

export enum BackupReason {
    AUTOMATIC = 'Automatic backup',
    SHUTDOWN = 'Shutdown backup',
    MANUAL = 'Manual backup'
}

