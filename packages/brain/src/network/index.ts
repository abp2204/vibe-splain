// Deterministic PreToolUse gate. No model, no network calls, no adapters.
// The escalation builder reads the gate index for the file an agent is about
// to edit and emits blast radius + dependents + risk warnings.
export * from './escalation.js';
export * from './gateIndex.js';
