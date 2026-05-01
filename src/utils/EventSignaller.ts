export type EventCallback = (params?: Record<string, string>) => Promise<void>;

export class EventBus {
    private _events: Map<string, EventCallback>;

    public constructor() {
        this._events = new Map();
    }

    public on(eventId: string, callback: EventCallback) {
        this._events.set(eventId, callback);
    }

    public async notify(eventId: string, params?: Record<string, string>) {
        const callback = this._events.get(eventId);
        if (callback) {
            await callback(params);
        }
    }
}
