export type SleepQuality = "GOOD" | "POOR";

/**
 * Adjusts a running risk score based on the AI-classified stress level of a single message.
 * Each message has a direct, immediate impact on the score.
 */
export function adjustRisk(currentRisk: number, stress: string, sleep?: string): number {
  let delta = 0;

  // Stress contribution (AI-classified per message)
  if (stress === "HIGH") delta += 25;
  else if (stress === "MEDIUM") delta += 8;
  else if (stress === "LOW") delta -= 20;

  // Sleep contribution
  if (sleep === "POOR") delta += 12;
  else if (sleep === "GOOD") delta -= 8;

  const newRisk = currentRisk + delta;
  // Clamp between 0 and 100
  return Math.max(0, Math.min(newRisk, 100));
}
