import React, { useState } from 'react';
import { getRecordPhotoUrl } from '../utils/recordPhoto';
import { evidenceItemsForRecord, EVIDENCE_MAX_FILES, snapshotEvidenceFile, validateEvidenceFiles } from '../utils/evidence';
import { isPdfPath } from './EvidenceViewer';
import { FileText, Trash2, X } from 'lucide-react';

function EvidenceFilesField({
  type,
  files,
  onFilesChange,
  existingRecord,
  removedIds = [],
  onRemovedIdsChange,
  disabled = false,
  required = false
}) {
  const [error, setError] = useState('');
  const [isReading, setIsReading] = useState(false);
  const allExisting = evidenceItemsForRecord(existingRecord);
  const removed = new Set(removedIds.map(Number));
  const visibleExisting = allExisting.filter((item) => !item.id || !removed.has(Number(item.id)));
  const remainingCount = visibleExisting.length + files.length;

  const handleSelection = async (event) => {
    const incoming = Array.from(event.target.files || []);
    event.target.value = '';
    if (incoming.length === 0) return;

    const next = [...files, ...incoming];
    const validationError = validateEvidenceFiles(next, visibleExisting.length);
    if (validationError) {
      setError(validationError);
      return;
    }

    setIsReading(true);
    setError('');
    try {
      const snapshots = [];
      for (const file of incoming) {
        snapshots.push(await snapshotEvidenceFile(file));
      }
      onFilesChange([...files, ...snapshots]);
    } catch {
      setError('Tidak dapat membaca file. Tunggu hingga file Google Drive siap, atau unduh ke perangkat lalu pilih kembali.');
    } finally {
      setIsReading(false);
    }
  };

  return (
    <div className="form-group">
      <label>
        Bukti pendukung{required ? ' (wajib)' : ''} (maks. {EVIDENCE_MAX_FILES} file, 10 MB per file)
      </label>
      {allExisting.length > 0 && (
        <div style={{ display: 'grid', gap: '6px', margin: '6px 0 10px' }}>
          {allExisting.map((item) => {
            const isRemoved = item.id && removed.has(Number(item.id));
            const url = getRecordPhotoUrl(item.path, type);
            return (
              <div
                key={item.id || item.path}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: isRemoved ? 0.55 : 1 }}
              >
                <a href={url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <FileText size={16} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.path.split(/[\\/]/).pop()}
                  </span>
                </a>
                {item.id && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={disabled}
                    onClick={() => {
                      onRemovedIdsChange(isRemoved
                        ? removedIds.filter((id) => Number(id) !== Number(item.id))
                        : [...removedIds, item.id]);
                    }}
                    aria-label={isRemoved ? 'Batalkan penghapusan bukti' : 'Hapus bukti'}
                    title={isRemoved ? 'Batalkan penghapusan' : 'Hapus bukti'}
                    style={{ padding: '3px 7px', lineHeight: 1 }}
                  >
                    {isRemoved ? <X size={14} /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            );
          })}
          {allExisting.some((item) => !item.id) && (
            <small className="text-muted">Jalankan migrasi bukti pada database untuk menghapus file lama satu per satu.</small>
          )}
        </div>
      )}
      <input
        type="file"
        multiple
        aria-required={required}
        disabled={disabled || isReading || remainingCount >= EVIDENCE_MAX_FILES}
        onChange={handleSelection}
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.jpg,.jpeg,.png,.gif,.webp,.pdf"
      />
      {files.length > 0 && (
        <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
          {files.map((file, index) => (
            <li key={`${file.name}-${file.size}-${file.lastModified}-${index}`} style={{ marginTop: '4px' }}>
              {isPdfPath(file.name) ? <FileText size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} /> : null}
              {file.name} ({(file.size / (1024 * 1024)).toFixed(2)} MB)
              <button
                type="button"
                className="btn btn-secondary"
                disabled={disabled || isReading}
                onClick={() => {
                  setError('');
                  onFilesChange(files.filter((_, fileIndex) => fileIndex !== index));
                }}
                aria-label={`Hapus file ${file.name}`}
                style={{ marginLeft: '8px', padding: '2px 6px', lineHeight: 1 }}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {isReading && <small className="text-muted" role="status">Menyiapkan file...</small>}
      <small className="text-muted">{remainingCount} dari {EVIDENCE_MAX_FILES} file dipilih.</small>
      {error && <div className="alert alert-danger" role="alert" style={{ marginTop: '8px' }}>{error}</div>}
    </div>
  );
}

export default EvidenceFilesField;
