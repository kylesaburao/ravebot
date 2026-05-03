import { failureRules } from "../../../src/bot/events/CounterGame";
import { SessionState } from "../../../src/bot/persistence/SessionPersistence";

type CounterState = SessionState['counter'];

const lastState = (lastNumber: number, lastAuthor: string): CounterState => ({ lastNumber, lastAuthor });

describe('CounterGame failureRules', () => {
    it('exposes exactly the two known rules in order', () => {
        expect(failureRules).toHaveLength(2);
    });

    describe('wrong-number rule (index 0)', () => {
        const { rule } = failureRules[0];

        it('passes when starting from 0 with no prior state', () => {
            expect(rule(0, 'alice', undefined)).toBe(false);
        });

        it('fails when the first number is not 0', () => {
            expect(rule(1, 'alice', undefined)).toBe(true);
            expect(rule(-1, 'alice', undefined)).toBe(true);
            expect(rule(42, 'alice', undefined)).toBe(true);
        });

        it('passes when the number is exactly lastNumber + 1', () => {
            expect(rule(6, 'alice', lastState(5, 'bob'))).toBe(false);
        });

        it('fails when the number skips, repeats, or goes backwards', () => {
            expect(rule(7, 'alice', lastState(5, 'bob'))).toBe(true);
            expect(rule(5, 'alice', lastState(5, 'bob'))).toBe(true);
            expect(rule(4, 'alice', lastState(5, 'bob'))).toBe(true);
        });

        it('does not consider the author', () => {
            expect(rule(6, undefined, lastState(5, 'bob'))).toBe(false);
            expect(rule(6, 'bob', lastState(5, 'bob'))).toBe(false);
        });
    });

    describe('wrong-user rule (index 1)', () => {
        const { rule } = failureRules[1];

        it('passes when there is no prior state', () => {
            expect(rule(0, 'alice', undefined)).toBe(false);
        });

        it('passes when the current author differs from the last author', () => {
            expect(rule(6, 'alice', lastState(5, 'bob'))).toBe(false);
        });

        it('fails when the current author matches the last author', () => {
            expect(rule(6, 'bob', lastState(5, 'bob'))).toBe(true);
        });

        it('passes when the current author is missing, even if last author is set', () => {
            expect(rule(6, undefined, lastState(5, 'bob'))).toBe(false);
        });

        it('does not consider the number', () => {
            expect(rule(999, 'bob', lastState(5, 'bob'))).toBe(true);
            expect(rule(999, 'alice', lastState(5, 'bob'))).toBe(false);
        });
    });
});
