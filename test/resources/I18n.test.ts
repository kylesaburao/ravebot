import { formatTranslation, getTranslation } from "../../src/resources/I18n";

describe('I18n', () => {
    it('returns the key when no translation exists', () => {
        expect(getTranslation('MISSING_TRANSLATION_KEY')).toBe('MISSING_TRANSLATION_KEY');
    });

    it('formats translated templates with provided values', () => {
        expect(formatTranslation('COUNTER_GAME_CURRENT_COUNT', {
            count: 7,
            userId: 'alice'
        })).toBe('Current count: 7 by <@alice>');
    });

    it('replaces repeated placeholders and leaves missing placeholders untouched', () => {
        expect(formatTranslation('{value} {value} {missing}', {
            value: 'seen'
        })).toBe('seen seen {missing}');
    });
});
