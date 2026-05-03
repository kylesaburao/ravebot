import { EventBus } from "../../../src/utils/EventBus";

describe('Eventbus', () => {
    it('does not allow duplicate callback registrations for the same event ID', () => {
        const bus = new EventBus();
        const callback = jest.fn().mockResolvedValue(undefined);
        bus.on('test-event', callback);
        expect(() => bus.on('test-event', callback)).toThrow(
            "Cannot reregister the same callback instance for event ID 'test-event'"
        );
    });

    it('allows different callbacks to be registered for the same event ID', () => {
        const bus = new EventBus();
        const callback1 = jest.fn().mockResolvedValue(undefined);
        const callback2 = jest.fn().mockResolvedValue(undefined);
        bus.on('test-event', callback1);
        expect(() => bus.on('test-event', callback2)).not.toThrow();
    });

    it('calls all registered callbacks when an event is notified', async () => {
        const bus = new EventBus();
        const callback1 = jest.fn().mockResolvedValue(undefined);
        const callback2 = jest.fn().mockResolvedValue(undefined);
        bus.on('test-event', callback1);
        bus.on('test-event', callback2);
        await bus.notify('test-event', { key: 'value' });
        expect(callback1).toHaveBeenCalledWith({ key: 'value' });
        expect(callback2).toHaveBeenCalledWith({ key: 'value' });
    });
});
