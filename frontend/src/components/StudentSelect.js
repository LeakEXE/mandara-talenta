import Select from 'react-select';

// Single searchable student picker combining Nama + NIS (replaces the old
// side-by-side "Cari nama siswa..." / "Cari NIS siswa..." dropdowns).
// Options read "Nama (NIS)" so typing either name or NIS filters the list.
// onSelect receives { nama, nis, kelas, grha } (or null when cleared),
// matching the handleStudentSelect shape in every IPT input form.
// For siswa self-input, renders one disabled field showing "Nama (NIS)".
function StudentSelect({ students = [], nama = '', nis = '', onSelect, isSiswa = false }) {
  if (isSiswa) {
    return (
      <div className="form-group">
        <label>Siswa <span className="required">*</span></label>
        <input
          type="text"
          value={nama && nis ? `${nama} (${nis})` : (nama || nis || '')}
          disabled
          style={{
            width: '100%',
            padding: '8px 12px',
            border: '1px solid #d0d0d0',
            borderRadius: '4px',
            backgroundColor: '#f5f5f5',
            color: '#666'
          }}
        />
      </div>
    );
  }

  const list = students || [];
  const selected = list.find((s) => s.nis === nis) || null;

  return (
    <div className="form-group">
      <label>Siswa <span className="required">*</span></label>
      <Select
        value={selected ? { value: selected.nis, label: `${selected.nama} (${selected.nis})`, nama: selected.nama, nis: selected.nis, kelas: selected.kelas, grha: selected.grha } : null}
        onChange={onSelect}
        options={list.map((student) => ({ value: student.nis, label: `${student.nama} (${student.nis})`, nama: student.nama, nis: student.nis, kelas: student.kelas, grha: student.grha }))}
        placeholder="Cari nama atau NIS siswa..."
        isSearchable
        isClearable
        styles={{
          control: (provided) => ({
            ...provided,
            minHeight: '40px'
          })
        }}
      />
    </div>
  );
}

export default StudentSelect;
