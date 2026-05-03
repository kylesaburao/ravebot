export class TaskQueue {
    private _concurrencyLimit: number;
    private _queue: (() => Promise<any>)[];
    private _activeCount: number;
    private _cooldownPeriod: number;

    public constructor(concurrency: number = 1, cooldownPeriod: number = 0) {
        if (concurrency <= 0) {
            throw new Error(`Invalid concurrency limit: ${concurrency}`);
        }
        if (cooldownPeriod < 0) {
            throw new Error(`Invalid cooldown period: ${cooldownPeriod}ms`);
        }

        this._concurrencyLimit = concurrency;
        this._queue = [];
        this._activeCount = 0;
        this._cooldownPeriod = cooldownPeriod;
    }

    public schedule(taskFn: () => Promise<any>) {
        return new Promise((resolve, reject) => {
            const queueAction = async () => {
                try {
                    const result = await taskFn();
                    resolve(result);
                } catch (error) {
                    reject(error);
                }
            };

            this._queue.push(queueAction);
            this.processNext();
        });
    }

    private async processNext() {
        if (this._activeCount >= this._concurrencyLimit || this._queue.length === 0) {
            return;
        }

        this._activeCount++;
        const task = this._queue.shift();

        try {
            if (task) {
                await task();
            }
        } finally {
            if (this._cooldownPeriod) {
                // Hold before releasing
                await new Promise(resolve => {
                    setTimeout(resolve, this._cooldownPeriod);
                });
            }
            this._activeCount--;
            this.processNext();
        }
    }
}
