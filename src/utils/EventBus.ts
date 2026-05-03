export type EventCallback = (params?: Record<string, string>) => Promise<void>;

export class EventBus {
    private _events: Map<string, Map<EventCallback, boolean>>;

    public constructor() {
        this._events = new Map();
    }

    private _register(eventId: string, callback: EventCallback, isOnce: boolean) {
        let callbacks = this._events.get(eventId);
        if (!callbacks) {
            callbacks = new Map();
            this._events.set(eventId, callbacks);
        }
        if (callbacks.has(callback)) {
            throw new Error(`Cannot reregister the same callback instance for event ID '${eventId}'`);
        }
        callbacks.set(callback, isOnce);
    }

    public on(eventId: string, callback: EventCallback) {
        this._register(eventId, callback, false);
    }

    public once(eventId: string, callback: EventCallback) {
        this._register(eventId, callback, true);
    }

    public remove(eventId: string, callback: EventCallback) {
        this._events.get(eventId)?.delete(callback);
    }

    public async notify(eventId: string, params?: Record<string, string>) {
        const callbacks = this._events.get(eventId);
        if (!callbacks) {
            return;
        }

        const currentCallbacks = [...callbacks];
        const nextCallbacks = currentCallbacks.filter(([_, isOnce]) => !isOnce);
        if (nextCallbacks.length !== currentCallbacks.length) {
            this._events.set(eventId, new Map(nextCallbacks));
        }
        await Promise.all(currentCallbacks.map(([callback]) => callback(params)));
    }
}
