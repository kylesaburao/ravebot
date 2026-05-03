export enum TaskQueueId {
    SYNCHRONOUS = 'SYNCHRONOUS',
    BACKUP = 'BACKUP',
    DEBUG = 'DEBUG'
}

export enum EventBusId {
    BACKUP_BUS = 'BACKUP_BUS',
    MAIN = 'MAIN'
}

export enum EventBackupBusIds {
    RUN_BACKUP = 'RUN_BACKUP'
}

export enum MainEventBus {
    LOCKDOWN = 'LOCKDOWN'
}

export enum BackupReason {
    AUTOMATIC = 'Automatic backup',
    SHUTDOWN = 'Shutdown backup',
    MANUAL = 'Manual backup'
}

