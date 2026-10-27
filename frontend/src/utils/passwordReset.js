export function validateTemporaryPassword(password, confirmation) {
    if (password !== confirmation) {
        return 'Konfirmasi password tidak cocok';
    }
    if (password.length < 6) {
        return 'Password sementara minimal 6 karakter';
    }
    return null;
}
