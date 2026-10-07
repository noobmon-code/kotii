// Comparação de segredos de agendamento (x-push-secret, x-cleanup-secret)
// sem vazar, pelo tempo, quanto do segredo bateu.

export function sameSecret(given: string | null, expected: string): boolean {
  if (given === null || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
