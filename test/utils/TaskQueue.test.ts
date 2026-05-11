import { TaskQueue } from "../../src/utils/TaskQueue";

describe('TaskQueue', () => {
    it('Should reject invalid concurrency', () => {
        expect(() => {
            new TaskQueue(0);
        }).toThrow();
        expect(() => {
            new TaskQueue(-1);
        }).toThrow();
    });

    it('Should execute tasks', async () => {
        for (const concurrency of [1, 100]) {
            const taskQueue = new TaskQueue(concurrency);
            let counter = 0;

            const longTask = async () => {
                await new Promise((resolve) => {
                    // Verify concurrency by multiple long task executions in bounded time window
                    const waitTime = concurrency === 1
                        ? 1
                        : 500;
                    setTimeout(resolve, waitTime);
                });
                counter++;
            };

            const promises = new Array(100).fill(0).map(() => {
                return taskQueue.schedule(longTask);
            });
            await Promise.all(promises);

            expect(counter).toBe(100);
        }
    });

    it('resolves with the value returned by the scheduled task', async () => {
        const taskQueue = new TaskQueue(1);
        await expect(taskQueue.schedule(async () => 42)).resolves.toBe(42);
        await expect(taskQueue.schedule(async () => ({ ok: true }))).resolves.toEqual({ ok: true });
    });

    it('rejects with the error thrown by the scheduled task', async () => {
        const taskQueue = new TaskQueue(1);
        await expect(taskQueue.schedule(async () => {
            throw new Error('task failed');
        })).rejects.toThrow('task failed');

        await expect(taskQueue.schedule(async () => 'still working')).resolves.toBe('still working');
    });
});
