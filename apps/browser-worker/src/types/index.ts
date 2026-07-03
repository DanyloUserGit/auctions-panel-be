export enum SessionEventType {
    ForbiddenAction = 'ForbiddenAction',
    Navigation = 'Navigation',
    SessionError = 'SessionError',
    TextInput = 'TextInput',
    ButtonClick = 'ButtonClick',
    Other = 'Other'
}

export enum LogSeverity {
    Info = 'Info',
    Warning = 'Warning',
    Critical = 'Critical'
}

export enum NotificationEventType {
    SESSION_STARTED = 'SESSION_STARTED',
    SESSION_ENDED = 'SESSION_ENDED',
    AUCTION_ENDED = 'AUCTION_ENDED',
    ADDED_TO_GROUP = 'ADDED_TO_GROUP',
    WORKER_ERROR = 'WORKER_ERROR',
    USER_LOGED_OUT = 'USER_LOGED_OUT',
}