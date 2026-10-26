export function add(a: number, b: number): number {
  if (a < 0) return 0;
  return a + b;
}
export const twice = (n: number) => add(n, n);
