// Single source of truth for every bit of vibe-splain jargon.
// Keyed by a stable slug; <Term k="..."> looks definitions up here.
// Keep definitions to one plain-English sentence — they render in a tooltip.

export interface GlossaryEntry {
  term: string;        // human label shown in the tooltip header
  def: string;         // one-sentence plain-English explanation
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ── Axes ───────────────────────────────────────────────
  gravity: {
    term: 'Gravity',
    def: 'How load-bearing a file is — how much else depends on it. High gravity means breaking it breaks a lot.',
  },
  heat: {
    term: 'Heat',
    def: 'How messy a file is right now: tangled logic, smells, and risky patterns. 0 is clean, 40+ is real debt.',
  },

  // ── Triage states ──────────────────────────────────────
  loadBearing: {
    term: 'Load-bearing',
    def: 'Lots of the codebase leans on this file. Changes here ripple outward.',
  },
  smelly: {
    term: 'Smelly',
    def: 'Shows code smells — signs of trouble like deep nesting, heavy mutation, or tangled dependencies. Not broken, but a warning sign.',
  },
  clean: {
    term: 'Clean',
    def: 'Low heat — no notable smells or risky patterns detected.',
  },

  // ── Card categories ────────────────────────────────────
  Risk: {
    term: 'Risk',
    def: 'A pattern likely to cause a bug or outage if left alone.',
  },
  Hack: {
    term: 'Hack',
    def: 'A shortcut that works for now but skips the proper solution — likely to bite later.',
  },
  Bottleneck: {
    term: 'Bottleneck',
    def: 'A chokepoint that slows the system or the team — performance or a single point everything funnels through.',
  },
  'Smart-Move': {
    term: 'Smart-Move',
    def: 'A deliberate, well-judged decision worth keeping and copying elsewhere.',
  },
  Convention: {
    term: 'Convention',
    def: 'An established pattern the codebase follows on purpose — learn it before you change it.',
  },
  'Dead-Weight': {
    term: 'Dead-Weight',
    def: 'Code that no longer earns its keep — unused, redundant, or safe to delete.',
  },

  // ── Card status ────────────────────────────────────────
  fresh: {
    term: 'Fresh',
    def: 'This finding still matches the current code.',
  },
  stale: {
    term: 'Stale',
    def: 'The underlying file changed since this card was written — re-check before trusting it.',
  },

  // ── Structure ──────────────────────────────────────────
  wildDiscoveries: {
    term: 'Wild Discoveries',
    def: 'The files that are both load-bearing AND smelly — the highest-leverage things to look at first.',
  },
  severity: {
    term: 'Severity',
    def: 'How urgent this finding is, from 1 (minor) to 5 (drop everything).',
  },
  blastRadius: {
    term: 'Blast radius',
    def: 'What else breaks or is affected if this code goes wrong.',
  },
};
