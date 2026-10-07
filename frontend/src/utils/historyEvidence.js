/**
 * Maps ipt_history `keterangan` text to the source record's evidence photo.
 *
 * History rows carry no record id only free text like `Prestasi: Lomba X`
 * (direct-submit path) or `Prestasi: Lomba X - Juara I Akademik` (approval
 * path). This builder indexes approved records by every keterangan variant
 * the backend can produce, so a history row resolves to its photo with an
 * exact string lookup (no fuzzy matching, no false positives).
 *
 * @param {object|null} records - getStudentRecords() response
 * @returns {Object<string,string>} keterangan -> foto path (only rows with a photo)
 */
function addVariants(map, foto, variants) {
    if (!foto) {
        return;
    }
    for (const key of variants) {
        if (key && !(key in map)) {
            map[key] = foto;
        }
    }
}

export function buildEvidenceMap(records) {
    const map = {};
    if (!records || typeof records !== 'object') {
        return map;
    }

    for (const r of records.prestasi || []) {
        addVariants(map, r.foto, [
            `Prestasi: ${r.nama_lomba}`,
            `Update Prestasi: ${r.nama_lomba}`,
            `Delete Prestasi: ${r.nama_lomba}`,
            `Prestasi: ${r.nama_lomba} - ${r.juara} ${r.kategori}`,
            // Legacy wording used by older backend versions
            `Poin dari Prestasi: ${r.nama_lomba}`,
        ]);
    }
    for (const r of records.organisasi || []) {
        addVariants(map, r.foto, [
            `Organisasi: ${r.jabatan_organisasi}`,
            `Update Organisasi: ${r.jabatan_organisasi}`,
            `Delete Organisasi: ${r.jabatan_organisasi}`,
            `Organisasi: ${r.kategori_organisasi} - ${r.jabatan_organisasi}`,
        ]);
    }
    for (const r of records.kepanitiaan || []) {
        addVariants(map, r.foto, [
            `Kepanitiaan: ${r.jabatan_kepanitiaan}`,
            `Update Kepanitiaan: ${r.jabatan_kepanitiaan}`,
            `Delete Kepanitiaan: ${r.jabatan_kepanitiaan}`,
            `Kepanitiaan: ${r.kategori_kepanitiaan} - ${r.jabatan_kepanitiaan}`,
        ]);
    }
    for (const r of records.event || []) {
        addVariants(map, r.foto, [
            `Event: ${r.nama_event}`,
            `Update Event: ${r.nama_event}`,
            `Delete Event: ${r.nama_event}`,
            `Event: ${r.nama_event} - ${r.tingkat}`,
        ]);
    }
    for (const r of records.pelanggaran || []) {
        addVariants(map, r.foto, [
            `Pelanggaran: ${r.jenis_pelanggaran}`,
            `Update Pelanggaran: ${r.jenis_pelanggaran}`,
            `Delete Pelanggaran: ${r.jenis_pelanggaran}`,
        ]);
    }
    for (const r of records.perilaku || []) {
        addVariants(map, r.foto, [
            `Perilaku: ${r.karakter_siswa}`,
            `Update Perilaku: ${r.karakter_siswa}`,
            `Delete Perilaku: ${r.karakter_siswa}`,
        ]);
    }

    return map;
}
