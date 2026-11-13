import React from 'react';

function GraduationStatusBadge({ isGraduated }) {
  return (
    <span
      style={{
        fontSize: '.72rem',
        fontWeight: 600,
        padding: '4px 10px',
        borderRadius: '999px',
        background: isGraduated ? '#f1f5f9' : '#dcfce7',
        color: isGraduated ? '#64748b' : '#16a34a'
      }}
    >
      {isGraduated ? 'Lulus' : 'Aktif'}
    </span>
  );
}

export default GraduationStatusBadge;
