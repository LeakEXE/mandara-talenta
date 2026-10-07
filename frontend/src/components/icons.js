import React from 'react';
import {
  Trophy,
  Users,
  Handshake,
  CalendarDays,
  TriangleAlert,
  Star,
  CircleCheck,
  CircleX,
  Clock,
  Medal,
  GraduationCap
} from 'lucide-react';

// Single icon language for the app (lucide, stroke-based, currentColor).
// Category icons same six everywhere (Dashboard, Leaderboard,
// IzinAkun, KonfigurasiIPT, WaliKelas history).
export const CATEGORY_ICONS = {
  prestasi: Trophy,
  organisasi: Users,
  kepanitiaan: Handshake,
  event: CalendarDays,
  pelanggaran: TriangleAlert,
  perilaku: Star,
  pembina: GraduationCap
};

export function CategoryIcon({ name, size = 16, ...rest }) {
  const C = CATEGORY_ICONS[name];
  return C ? <C size={size} {...rest} /> : null;
}

// Rank medals gold / silver / bronze (replaces 🥇🥈🥉).
const MEDAL_COLORS = { 1: '#f59e0b', 2: '#94a3b8', 3: '#cd7f32' };

export function MedalIcon({ rank, size = 26, ...rest }) {
  return <Medal size={size} color={MEDAL_COLORS[rank] || 'currentColor'} {...rest} />;
}

// Approval status (replaces ✅❌⏳ in badges and buttons).
const STATUS_ICONS = {
  approved: CircleCheck,
  rejected: CircleX,
  pending: Clock
};

export function StatusIcon({ status, size = 14, ...rest }) {
  const C = STATUS_ICONS[status];
  return C ? <C size={size} {...rest} /> : null;
}
