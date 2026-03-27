export enum SessionEventType {
    ForbiddenAction,
    Navigation,
    SessionError,
    TextInput,
    ButtonClick,
    Other
}
export enum LogSeverity {
    Info,
    Warning,
    Critical
}
export enum NotificationEventType {
  SESSION_STARTED = 'SESSION_STARTED',
  SESSION_EXPIRING = 'SESSION_EXPIRING',
  SESSION_ENDED = 'SESSION_ENDED',
  AUCTION_ENDED = 'AUCTION_ENDED',
  ADDED_TO_GROUP = 'ADDED_TO_GROUP',
  WORKER_ERROR = 'WORKER_ERROR',
  USER_LOGED_IN = 'USER_LOGED_IN',
  USER_LOGED_OUT = 'USER_LOGED_OUT',
}