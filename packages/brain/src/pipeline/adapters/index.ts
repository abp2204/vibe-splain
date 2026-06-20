// Domain adapter infrastructure. Public surface for the pipeline.
//
// This is a generic extension point: a DomainAdapter can contribute behavioral
// lift, severity boosts, and classification hints for a specific product. No
// domain adapters ship with the open-source core — the registry runs EMPTY, so
// every scan is pure generic static analysis and gravity == staticGravity.
//
// To add one, implement DomainAdapter (see types.ts) and register it here:
//   adapterRegistry.register(myAdapter);

export * from './types.js';
export { AdapterRegistry, adapterRegistry } from './registry.js';
