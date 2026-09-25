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

// Воркер надсилає лише системні сповіщення про збої (отримувачі - Super Admin).
export enum NotificationEventType {
    WORKER_ERROR = 'WORKER_ERROR',
}
