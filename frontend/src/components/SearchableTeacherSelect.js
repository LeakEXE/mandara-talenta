import Select from 'react-select';

// Searchable dropdown for guru/pegawai/pembina lists.
// Teachers prop: [{ id, nama, nip }]
// Single mode (default): value = teacher id (string/number) or '';
// onChange receives id as string ('' when cleared), mimics e.target.value.
// Multi mode (isMulti): value = array of ids; onChange receives string[]
// of ids ([] when cleared).
function SearchableTeacherSelect({
  value,
  teachers = [],
  onChange,
  placeholder = 'Cari nama guru...',
  isClearable = true,
  isDisabled = false,
  required = false,
  isMulti = false,
  inputId,
}) {
  const options = (teachers || []).map((t) => ({
    value: String(t.id),
    label: t.nip ? `${t.nama} (${t.nip})` : t.nama,
  }));

  const selected = isMulti
    ? options.filter((o) => (value || []).map(String).includes(o.value))
    : value === '' || value === null || value === undefined
      ? null
      : options.find((o) => o.value === String(value)) ||
        // Fallback: keep showing raw id if teacher list hasn't loaded yet
        null;

  const hiddenValue = isMulti
    ? (selected || []).map((o) => o.value).join(',')
    : selected
      ? selected.value
      : '';

  return (
    <div style={{ position: 'relative' }}>
      <Select
        inputId={inputId}
        value={selected}
        onChange={(opt) =>
          onChange &&
          onChange(isMulti ? (opt || []).map((o) => o.value) : opt ? opt.value : '')
        }
        options={options}
        placeholder={placeholder}
        isSearchable
        isMulti={isMulti}
        isClearable={isClearable}
        isDisabled={isDisabled}
        noOptionsMessage={() => 'Tidak ditemukan'}
        styles={{
          control: (provided, state) => ({
            ...provided,
            minHeight: '40px',
            borderRadius: '4px',
            borderColor:
              required && !selected ? '#ef4444' : state.isFocused ? '#2684FF' : provided.borderColor,
            boxShadow: state.isFocused ? '0 0 0 1px #2684FF' : provided.boxShadow,
          }),
          menu: (provided) => ({ ...provided, zIndex: 1600 }),
        }}
      />
      {required && (
        <input
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={hiddenValue}
          onChange={() => {}}
          required
          style={{
            opacity: 0,
            height: 0,
            width: '100%',
            position: 'absolute',
            bottom: 0,
            left: 0,
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

export default SearchableTeacherSelect;
