import { validateTemporaryPassword } from './passwordReset';

describe('temporary password validation', () => {
    test('rejects a password confirmation mismatch', () => {
        expect(validateTemporaryPassword('abc123', 'abc124'))
            .toBe('Konfirmasi password tidak cocok');
    });

    test('rejects passwords shorter than six characters', () => {
        expect(validateTemporaryPassword('abc12', 'abc12'))
            .toBe('Password sementara minimal 6 karakter');
    });

    test('accepts a matching password of at least six characters', () => {
        expect(validateTemporaryPassword('abc123', 'abc123')).toBeNull();
    });
});
