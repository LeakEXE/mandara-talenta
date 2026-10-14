"use client";

import React from 'react';

// Filter panel matching KelolaAkun's style: labeled fields, focus rings,
// hover states, and a Reset button. Each filter is { key, label, type, value, onChange, options }.
function FilterBar({ searchPlaceholder, searchValue, onSearchChange, filters = [], onReset }) {
  const inputStyle = (e) => {
    if (e) {
      e.target.style.borderColor = 'var(--blue)';
      e.target.style.boxShadow = '0 0 0 2px rgba(30, 136, 229, 0.1)';
    }
  };
  const blurStyle = (e) => {
    if (e) {
      e.target.style.borderColor = '#d0d0d0';
      e.target.style.boxShadow = 'none';
    }
  };
  const baseFieldStyle = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d0d0d0',
    borderRadius: '4px',
    fontSize: '13px',
    background: 'white',
    color: '#333',
    transition: 'all 0.3s ease'
  };
  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    fontWeight: '600',
    color: '#666',
    marginBottom: '6px'
  };

  return (
    <div style={{ background: '#f9f9f9', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '16px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {/* Search */}
        <div style={{ flex: '2', minWidth: '200px' }}>
          <label style={labelStyle}>Cari</label>
          <input
            type="text"
            value={searchValue}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            style={baseFieldStyle}
            onFocus={inputStyle}
            onBlur={blurStyle}
          />
        </div>

        {/* Dynamic filters */}
        {filters.map((f) => (
          <div key={f.key} style={{ flex: '1', minWidth: '160px' }}>
            <label style={labelStyle}>{f.label}</label>
            {f.type === 'select' ? (
              <select
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                style={baseFieldStyle}
                onFocus={inputStyle}
                onBlur={blurStyle}
              >
                {f.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type}
                value={f.value}
                onChange={(e) => f.onChange(e.target.value)}
                placeholder={f.placeholder}
                style={baseFieldStyle}
                onFocus={inputStyle}
                onBlur={blurStyle}
              />
            )}
          </div>
        ))}

        {/* Reset */}
        {onReset && (
          <button
            onClick={onReset}
            style={{
              padding: '8px 14px',
              background: '#f5f5f5',
              border: '1px solid #d0d0d0',
              borderRadius: '4px',
              fontSize: '13px',
              cursor: 'pointer',
              color: '#666',
              transition: 'all 0.3s ease'
            }}
            onMouseOver={(e) => { e.target.style.background = '#efefef'; e.target.style.borderColor = '#bbb'; }}
            onMouseOut={(e) => { e.target.style.background = '#f5f5f5'; e.target.style.borderColor = '#d0d0d0'; }}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  );
}

export default FilterBar;
