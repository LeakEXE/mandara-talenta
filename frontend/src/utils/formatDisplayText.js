// Converts stored enum-style values into human-readable labels.
// Examples: 'juara_ii' -> 'Juara II', 'harapan_i' -> 'Harapan I',
//           'kecamatan' -> 'Kecamatan', 'prestasi_update' -> 'Prestasi Update'.
// Words consisting only of i/v/x are treated as Roman numerals and upper-cased.
export function formatDisplayText(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/_/g, ' ')
    .replace(/\b\w+\b/g, (word) => {
      if (/^[ivx]+$/.test(word.toLowerCase())) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
}

// Formats a DATE value (YYYY-MM-DD or ISO datetime) as Indonesian short
// date without timezone shift ('2026-10-05' -> '5 Okt 2026').
// Returns '-' when empty/unparseable. Used for tanggal_pelaksanaan.
export function formatTanggalLomba(value) {
  if (value === null || value === undefined || value === '') return '-';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const mi = parseInt(m[2], 10);
    const di = parseInt(m[3], 10);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return '-';
    return `${di} ${months[mi - 1]} ${m[1]}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Normalizes a DATE/ISO value to the YYYY-MM-DD shape required by
// <input type="date">. Returns '' when empty.
export function toDateInputValue(value) {
  if (value === null || value === undefined || value === '') return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

export default formatDisplayText;
