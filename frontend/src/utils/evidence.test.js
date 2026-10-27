import { evidenceItemsForRecord, snapshotEvidenceFile, validateEvidenceFiles } from './evidence';

const makeFile = (name, type, size = 1024) => ({ name, type, size });

describe('evidence file validation', () => {
    test('accepts up to five allowed files, each within the size limit', () => {
        const files = Array.from({ length: 5 }, (_, index) =>
            makeFile(`evidence-${index}.pdf`, 'application/pdf', 10 * 1024 * 1024)
        );

        expect(validateEvidenceFiles(files)).toBeNull();
    });

    describe('evidence file snapshot', () => {
        test('copies file bytes and preserves filename, MIME type, and last-modified time', async () => {
            const bytes = new Uint8Array([37, 80, 68, 70, 45, 49]);
            const source = {
                name: 'drive-evidence.pdf',
                type: 'application/pdf',
                size: bytes.length,
                lastModified: 123456,
                arrayBuffer: jest.fn().mockResolvedValue(bytes.buffer)
            };

            const snapshot = await snapshotEvidenceFile(source);

            expect(snapshot).toBeInstanceOf(File);
            expect(snapshot.name).toBe(source.name);
            expect(snapshot.type).toBe(source.type);
            expect(snapshot.lastModified).toBe(source.lastModified);
            expect(snapshot.size).toBe(bytes.length);
            expect(source.arrayBuffer).toHaveBeenCalledTimes(1);
            const snapshotBytes = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(Array.from(new Uint8Array(reader.result)));
                reader.onerror = () => reject(reader.error);
                reader.readAsArrayBuffer(snapshot);
            });
            expect(snapshotBytes).toEqual(Array.from(bytes));
        });

        test('rejects unsupported native Google document types before reading', async () => {
            const source = {
                name: 'evidence.pdf',
                type: 'application/vnd.google-apps.document',
                size: 1024,
                arrayBuffer: jest.fn()
            };

            await expect(snapshotEvidenceFile(source)).rejects.toThrow(
                'File harus berupa gambar (JPG, PNG, GIF, WebP) atau PDF.'
            );
            expect(source.arrayBuffer).not.toHaveBeenCalled();
        });

        test('propagates read failures so the picker can show its recovery message', async () => {
            const source = {
                name: 'drive-evidence.pdf',
                type: 'application/pdf',
                size: 1024,
                arrayBuffer: jest.fn().mockRejectedValue(new Error('source file unavailable'))
            };

            await expect(snapshotEvidenceFile(source)).rejects.toThrow('source file unavailable');
        });
    });

    test('counts existing files against the five-file limit', () => {
        expect(validateEvidenceFiles([makeFile('new.png', 'image/png')], 5))
            .toBe('Maksimal 5 file bukti per data.');
    });

    test('rejects a file over 10 MB', () => {
        expect(validateEvidenceFiles([
            makeFile('large.pdf', 'application/pdf', 10 * 1024 * 1024 + 1)
        ])).toBe('Ukuran file maksimal 10MB.');
    });

    test('keeps evidence entries and falls back to a legacy photo path', () => {
        const evidence = [{ id: 7, path: 'uploads/event/evidence.pdf' }];

        expect(evidenceItemsForRecord({ evidence, foto: 'legacy.jpg' })).toEqual(evidence);
        expect(evidenceItemsForRecord({ foto: 'uploads/event/legacy.jpg' })).toEqual([
            { id: null, path: 'uploads/event/legacy.jpg' }
        ]);
    });
});
