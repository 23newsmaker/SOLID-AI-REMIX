import type { Role, MemberStatus } from '@workspace/api-client-react';

export const roleLabel: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CREATOR: 'Kreator',
  REVIEWER_COMPLIANCE: 'Reviewer Kepatuhan',
  VIEWER: 'Pengamat',
};

export const statusLabel: Record<MemberStatus, string> = {
  PENDING: 'Menunggu',
  ACTIVE: 'Aktif',
  SUSPENDED: 'Ditangguhkan',
};

export function errMsg(e: unknown, fallback = 'Terjadi kesalahan. Coba lagi.'): string {
  if (!e) return fallback;
  const any = e as { data?: { error?: string }; message?: string };
  return any.data?.error || any.message || fallback;
}

export function errStatus(e: unknown): number | undefined {
  return (e as { status?: number })?.status;
}

export function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || 'S';
}
