import type { CardCategory } from './types';

export interface CategoryStyle {
  color: string;   // hex
  label: string;
  glyph: string;
}

export const CATEGORY_STYLES: Record<CardCategory, CategoryStyle> = {
  'Risk':       { color: '#ff4d5e', label: 'Risk', glyph: '⚠' },
  'Hack':       { color: '#ff6b9d', label: 'Hack', glyph: '✕' },
  'Bottleneck': { color: '#f5a623', label: 'Bottleneck', glyph: '⧗' },
  'Smart-Move': { color: '#3ddc97', label: 'Smart-Move', glyph: '✦' },
  'Convention': { color: '#00e5cc', label: 'Convention', glyph: '◈' },
  'Dead-Weight':{ color: '#6b7280', label: 'Dead-Weight', glyph: '∅' },
};

export function categoryStyle(cat?: CardCategory): CategoryStyle {
  return (cat && CATEGORY_STYLES[cat]) || { color: '#00e5cc', label: cat || 'Decision', glyph: '◈' };
}
