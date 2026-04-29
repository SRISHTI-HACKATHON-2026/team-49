import type { StressLevel } from "@/models/Message";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
const VALID_STRESS_LEVELS: StressLevel[] = ["LOW", "MEDIUM", "HIGH"];

const CLASSIFIER_SYSTEM_PROMPT = `You are a strict stress analysis system.
Analyze the user's message and return ONLY valid JSON in this format:
{"stress":"LOW|MEDIUM|HIGH"}

Rules:

- HIGH = strong emotional load, distress, overwhelm, extreme pressure, or any serious harmful thoughts
- MEDIUM = moderate pressure, busy, disappointed, tired but manageable
- LOW = calm, relaxed, neutral, or positive without pressure

Do not explain anything. Only return JSON.`;

const SYSTEM_PROMPT = `You are Care Companion, a subtle conversational assistant for caregivers.

PURPOSE:
Respond in a way that reflects the emotional intensity of the user message while staying natural, non-intrusive, and context-aware.

CORE BEHAVIOR:
- Respond naturally like a thoughtful human, not a system
- Keep responses short (1-2 sentences)
- Be calm, respectful, and low-pressure
- Stay subtle and never reveal analysis or scoring

STRICT RULES:
- Do NOT use mental health terms
- Do NOT diagnose or label the user
- Do NOT give medical or professional advice
- Do NOT ask deep questions
- Do NOT over-explain or give long responses
- Avoid generic phrases like "I understand" or "I'm here for you"
- Do NOT mention "tone", "analysis", or system behavior

RESPONSE STRATEGY:
- Match emotional intensity, not sentiment.
- If stress is HIGH (negative) or MEDIUM: Respond empathetically to their situation. Do NOT give explicit recommendations or suggestions for activities in your text. The system provides separate suggestion chips. Just be supportive and natural, e.g., "Sounds like a long stretch. Hope you get a quiet minute soon."
- HIGH positive: respond lightly positive.
- LOW: calm, neutral, or lightly positive response without suggestions.

PATTERN AWARENESS:
If a recent pattern is provided, occasionally reflect it gently without labeling. Do not overuse pattern reflections.

TONE:
Quiet, observant, non-judgmental. Match user intensity without exaggerating.

FINAL INSTRUCTION:
Always reflect intensity and context, not just positive vs negative sentiment.

RESPONSE FORMAT (MANDATORY - NO EXCEPTIONS):
You MUST respond with ONLY a valid JSON object. Do NOT write any text before or after the JSON.
The JSON must have exactly two fields:
{"reply": "your conversational response here", "suggestions": ["suggestion 1", "suggestion 2"]}
Rules:
- "reply" = your conversational response (string)
- "suggestions" = array of 2-3 short, actionable suggestion phrases in the SAME language as the reply
- Output ONLY the JSON object, nothing else. No markdown, no explanation, no preamble.`;

export async function classifyStress(userMessage: string): Promise<StressLevel> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      temperature: 0,
      max_tokens: 40,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenRouter classification failed: ${response.status} ${details}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = data.choices?.[0]?.message?.content?.trim();

  if (!output) {
    return "MEDIUM";
  }

  try {
    const parsed = JSON.parse(output) as { stress?: string };
    if (parsed.stress && VALID_STRESS_LEVELS.includes(parsed.stress as StressLevel)) {
      return parsed.stress as StressLevel;
    }
  } catch {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]) as { stress?: string };
        if (parsed.stress && VALID_STRESS_LEVELS.includes(parsed.stress as StressLevel)) {
          return parsed.stress as StressLevel;
        }
      } catch {
        return "MEDIUM";
      }
    }
  }

  return "MEDIUM";
}

export async function generateReply(
  userMessage: string,
  stress: StressLevel,
  recentPattern?: string,
  highSignal?: "POSITIVE" | "NEGATIVE" | "NEUTRAL",
  language?: string,
  history?: Array<{role: string, text: string}>,
  userInterests?: string[],
  riskScore?: number
) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT + `\n\nLANGUAGE TARGET: The user's UI locale is ${language || "auto"}. \n\nCRITICAL SCRIPT RULE: If the user types using English alphabets but the words are actually Kannada (Kanglish, e.g. "hegiddira"), Marathi, or Hindi, you MUST detect the underlying language and reply strictly in the NATIVE SCRIPT of that language (e.g., reply in actual Kannada script like 'ನಮಸ್ಕಾರ'). Never reply in English or English letters if the underlying meaning is an Indian language. \n\nQUALITY REQUIREMENT: When generating Kannada or other regional languages, the response MUST be of the absolute highest linguistic quality. Use highly fluent, natural, grammatically flawless, and culturally authentic phrasing. Avoid literal or robotic machine translations. The regional language output must feel incredibly polished, empathetic, and human-like.`,
        },
        ...(history || []).map((msg) => ({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.text,
        })),
        {
          role: "user",
          content: `User message: ${userMessage} | Detected stress level: ${stress}${highSignal ? ` | High intensity signal: ${highSignal}` : ""}${recentPattern ? ` | Recent pattern: ${recentPattern}` : ""}${userInterests?.length ? ` | User Interests: ${userInterests.join(', ')}` : ""}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 80,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`OpenRouter request failed: ${response.status} ${details}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  let reply = content;
  let suggestions: string[] = [];

  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(content);
    if (parsed.reply) reply = parsed.reply;
    if (parsed.suggestions && Array.isArray(parsed.suggestions)) suggestions = parsed.suggestions;
  } catch (e) {
    // Try extracting JSON from mixed text+JSON output
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed.reply) reply = parsed.reply;
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) suggestions = parsed.suggestions;
      } catch (err) {
        // JSON was malformed, strip any JSON fragments from the reply
        reply = content.replace(/\{[\s\S]*$/, "").trim() || content;
      }
    }
  }

  // Final safety: strip any leftover JSON from reply text
  if (reply.includes('{"reply"') || reply.includes('{"suggestions"')) {
    reply = reply.replace(/\s*\{[\s\S]*$/, "").trim();
  }

  return { reply, suggestions };
}
