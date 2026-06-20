export function capComponent(value: number, cap: number): number {
  return Math.max(0, Math.min(value, cap));
}

export function boundedSum(values: number[], cap: number): number {
  const sum = values.reduce((a, b) => a + b, 0);
  return capComponent(sum, cap);
}
