const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateCurrentClass,
    calculateFullClass,
    getClassInfo,
    getCurrentAcademicYear,
    shouldGraduate
} = require('../utils/academicYear');

test('academic year changes from June to July', () => {
    assert.equal(getCurrentAcademicYear(new Date(2027, 5, 30, 12)), '2026-2027');
    assert.equal(getCurrentAcademicYear(new Date(2027, 6, 1, 12)), '2027-2028');
});

test('student class advances each academic year before graduation', () => {
    assert.equal(calculateCurrentClass('2024-2025', '2024-2025'), 'X');
    assert.equal(calculateCurrentClass('2024-2025', '2025-2026'), 'XI');
    assert.equal(calculateCurrentClass('2024-2025', '2026-2027'), 'XII');
    assert.equal(calculateFullClass('2024-2025', 'TKJ 1', '2026-2027'), 'XII TKJ 1');
});

test('student is graduated starting in the fourth academic year', () => {
    assert.equal(shouldGraduate('2024-2025', '2026-2027'), false);
    assert.equal(shouldGraduate('2024-2025', '2027-2028'), true);
    assert.deepEqual(getClassInfo('2024-2025', '2027-2028'), {
        currentClass: null,
        isGraduated: true,
        enrollmentYear: '2024-2025',
        currentAcademicYear: '2027-2028'
    });
});
