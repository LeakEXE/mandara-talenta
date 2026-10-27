import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GroupSubmissionDetailsModal from './GroupSubmissionDetailsModal';
import { canEditGroupSubmission } from '../utils/prestasiSubmission';

const group = {
    groupId: 'grp-1',
    members: [
        {
            id: 1,
            nama: 'I Putu Darsana',
            nis: '1001',
            kelas: 'XI A',
            grha: 'Cendana',
            nama_lomba: 'Lomba Sains',
            jenis_lomba: 'akademik',
            kategori_lomba: 'kelompok',
            juara: 'juara_i',
            kategori: 'kabupaten',
            pembina_list: ['Ibu Pembina'],
            tanggal_pelaksanaan: '2026-10-01',
            created_at: '2026-10-02T10:00:00.000Z',
            submitted_by: 1,
            status: 'pending',
            evidence: [{ id: 10, path: 'uploads/prestasi/proof.pdf' }]
        },
        {
            id: 2,
            nama: 'Made Siswa',
            nis: '1002',
            kelas: 'XI B',
            grha: 'Kamboja',
            nama_lomba: 'Lomba Sains',
            kategori_lomba: 'kelompok',
            status: 'pending',
            submitted_by: 1,
            evidence: [{ id: 11, path: 'uploads/prestasi/proof.pdf' }]
        }
    ]
};

describe('group submission details', () => {
    test('shows complete read-only submission details and evidence to group members', () => {
        const markup = renderToStaticMarkup(
            <GroupSubmissionDetailsModal group={group} onClose={() => {}} />
        );

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain('Lomba Sains');
        expect(markup).toContain('I Putu Darsana');
        expect(markup).toContain('Made Siswa');
        expect(markup).toContain('Ibu Pembina');
        expect(markup).toContain('proof.pdf');
        expect(markup).toContain('/uploads/prestasi/proof.pdf');
        expect(markup).not.toContain('Edit');
    });

    test('keeps pending group editing exclusive to its submitter', () => {
        expect(canEditGroupSubmission(group.members, 1)).toBe(true);
        expect(canEditGroupSubmission(group.members, 2)).toBe(false);
    });

    test('does not allow editing when any group row is no longer pending', () => {
        const partlyApproved = group.members.map((member, index) => (
            index === 1 ? { ...member, status: 'approved' } : member
        ));

        expect(canEditGroupSubmission(partlyApproved, 1)).toBe(false);
        expect(canEditGroupSubmission([], 1)).toBe(false);
        expect(canEditGroupSubmission(group.members, null)).toBe(false);
    });
});
