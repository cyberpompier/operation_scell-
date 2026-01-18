
import React from 'react';

export const COLORS = {
  NAVY: '#0A192F',
  NEON: '#F0FF00',
  ALERT: '#FF0000',
  MUTED: '#1B2C45'
};

export const CHRONOGRAM_TIMES = [
  "09:00", "10:30", "12:00", "13:30", "15:30", "17:30"
];

export const RETICLE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-6 h-6">
    <path d="M12 3v3m0 12v3M3 12h3m12 0h3M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </svg>
);

export const DOSSIER_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6">
    <path d="M4 6h16M4 10h16M4 14h8M4 18h16" strokeLinecap="round" />
  </svg>
);
