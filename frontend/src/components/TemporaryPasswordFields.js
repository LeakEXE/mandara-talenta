import React from 'react';

function TemporaryPasswordFields({
  password,
  onPasswordChange,
  confirmation,
  onConfirmationChange,
  showPassword,
  onTogglePassword,
  onGenerate
}) {
  return (
    <>
      <div className="form-group">
        <label>Password Sementara</label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="Minimal 6 karakter"
            autoComplete="new-password"
            required
            style={{ flex: '1 1 160px', minWidth: 0 }}
          />
          <button type="button" className="btn btn-secondary" onClick={onTogglePassword}>
            {showPassword ? 'Sembunyi' : 'Lihat'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onGenerate}>
            Generate
          </button>
        </div>
      </div>
      <div className="form-group">
        <label>Konfirmasi Password Sementara</label>
        <input
          type="password"
          value={confirmation}
          onChange={(event) => onConfirmationChange(event.target.value)}
          autoComplete="new-password"
          required
        />
      </div>
    </>
  );
}

export default TemporaryPasswordFields;
