// Desil DTSEN (BPS/Kemensos) shared display helpers.
// 1 = kesejahteraan terendah, 10 = tertinggi. Mirrors backend
// utils/studentFields.js DESIL_LABELS so the wording can't drift.
export const DESIL_LABELS = {
  1: 'Sangat miskin',
  2: 'Miskin',
  3: 'Hampir miskin',
  4: 'Rentan miskin',
  5: 'Menengah bawah',
  6: 'Menengah',
  7: 'Menengah',
  8: 'Menengah atas',
  9: 'Kaya',
  10: 'Sangat kaya'
};

// "5 - Menengah bawah", or the empty label when unrecorded/invalid.
export function formatDesil(value, emptyLabel = 'Tidak terdata') {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 10) return emptyLabel;
  return `${n} - ${DESIL_LABELS[n]}`;
}

// Select options for editors (superadmin + wali kelas). Empty value = NULL.
export const DESIL_OPTIONS = [
  { value: '', label: 'Tidak terdata' },
  ...Object.entries(DESIL_LABELS).map(([value, label]) => ({
    value: Number(value),
    label: `${value} - ${label}`
  }))
];
