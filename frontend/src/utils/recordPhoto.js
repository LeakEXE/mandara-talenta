const UPLOAD_FOLDERS = {
    prestasi: 'prestasi',
    event: 'event',
    organisasi: 'organisasi',
    kepanitiaan: 'kepanitiaan',
    pelanggaran: 'pelanggaran'
};

export function getRecordPhotoUrl(path, type) {
    if (!path) {
        return null;
    }

    // Handle absolute URLs (http:// or https://)
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }

    // For relative paths in consolidated deployment, use relative URLs
    let cleanPath = path;

    if (path.includes('\\') || /^[A-Za-z]:/.test(path)) {
        const filename = path.split('\\').pop().split('/').pop();
        const folder = path.includes('approvals')
            ? 'approvals'
            : (UPLOAD_FOLDERS[type] || 'approvals');
        cleanPath = `/uploads/${folder}/${filename}`;
    } else if (path.startsWith('/uploads/')) {
        cleanPath = path;
    } else if (path.startsWith('uploads/')) {
        cleanPath = `/${path}`;
    } else {
        const folder = path.includes('approvals') ? 'approvals' : (UPLOAD_FOLDERS[type] || 'approvals');
        cleanPath = `/uploads/${folder}/${path}`;
    }

    return cleanPath;
}
