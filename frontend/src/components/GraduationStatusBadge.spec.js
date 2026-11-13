import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GraduationStatusBadge from './GraduationStatusBadge';

describe('GraduationStatusBadge', () => {
  test('renders graduated students with the subdued Lulus badge', () => {
    const markup = renderToStaticMarkup(
      <GraduationStatusBadge isGraduated />
    );

    expect(markup).toContain('>Lulus</span>');
    expect(markup).toContain('background:#f1f5f9');
    expect(markup).toContain('color:#64748b');
  });

  test('keeps active students visually distinct', () => {
    const markup = renderToStaticMarkup(
      <GraduationStatusBadge isGraduated={false} />
    );

    expect(markup).toContain('>Aktif</span>');
    expect(markup).toContain('background:#dcfce7');
    expect(markup).toContain('color:#16a34a');
  });
});
