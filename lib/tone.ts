import type { StressLevel } from "@/models/Message";

const INTENSIFIERS = ["very", "really", "so", "extremely", "too", "quite", "super"];

const STRONG_POSITIVE = ["happy", "excited", "amazing", "love", "thrilled"];
const STRONG_NEGATIVE = [
  "exhausted",
  "overwhelmed",
  "frustrated",
  "can't handle",
  "burned out",
  "burnt out",
];

const MODERATE_INDICATORS = [
  "busy",
  "a lot to do",
  "tiring",
  "bit tired",
  "okay but busy",
  "packed day",
  "full day",
];

const LOW_INDICATORS = ["fine", "okay", "normal", "nothing much", "just another day"];

function normalizeText(input: string) {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

function countMatches(text: string, phrases: string[]) {
  return phrases.reduce((count, phrase) => count + (text.includes(phrase) ? 1 : 0), 0);
}

export function detectTone(input: string): StressLevel {
  const text = normalizeText(input);
  const emotionLexicon = [...STRONG_POSITIVE, ...STRONG_NEGATIVE];

  const strongPositiveCount = countMatches(text, STRONG_POSITIVE);
  const strongNegativeCount = countMatches(text, STRONG_NEGATIVE);
  const strongEmotionCount = strongPositiveCount + strongNegativeCount;
  const intensifierCount = countMatches(text, INTENSIFIERS);
  const moderateCount = countMatches(text, MODERATE_INDICATORS);
  const lowCount = countMatches(text, LOW_INDICATORS);
  const emotionWordCount = countMatches(text, emotionLexicon);
  const factualQuestion = text.endsWith("?") && emotionWordCount === 0 && intensifierCount === 0;

  // High intensity wins on any strong emotion or explicit intensifier.
  if (strongEmotionCount > 0 || intensifierCount > 0) {
    return "HIGH";
  }

  // Tie-breaker: 2+ emotion-related mentions should still count as high.
  if (emotionWordCount >= 2) {
    return "HIGH";
  }

  if (factualQuestion) {
    return "LOW";
  }

  if (moderateCount > 0) {
    return "MEDIUM";
  }

  if (lowCount > 0) {
    return "LOW";
  }

  // Fail-safe: if not clearly low, choose medium.
  return text.length === 0 ? "LOW" : "MEDIUM";
}
