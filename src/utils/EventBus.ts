export type EventCallback = (params?: Record<string, string>) => Promise<void>;

export class EventBus {
    private _events: Map<string, EventCallback[]>;

    public constructor() {
        this._events = new Map();
    }

    public on(eventId: string, callback: EventCallback) {
        const events = this._events.get(eventId);
        if (events) {
            if (events.includes(callback)) {
                throw new Error(`Cannot reregister the same callback instance for event ID \'${eventId}\'`);
            }
        }

        this._events.set(
            eventId,
            [
                ...(events ? events : []),
                callback
            ]
        );
    }

    public async notify(eventId: string, params?: Record<string, string>) {
        const callbacks = this._events.get(eventId);
        if (callbacks) {
            const listenerCompletions = callbacks.map(callback => callback(params));
            await Promise.all(listenerCompletions);
        }
    }
}
