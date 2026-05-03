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
});
