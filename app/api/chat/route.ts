import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { addMemoryMessage, getMemoryHistory } from "@/lib/memoryStore";
import { classifyStress, generateReply } from "@/lib/openrouter";
import type { StressLevel } from "@/models/Message";
import Message from "@/models/Message";

function summarizeRecentPattern(recentStressLevels: StressLevel[]) {
  if (recentStressLevels.length < 3) {
    return undefined;
  }

  const highCount = recentStressLevels.filter((stress) => stress === "HIGH").length;
  const mediumOrHigh = recentStressLevels.filter((stress) => stress !== "LOW").length;

  if (highCount >= 3) {
    return "several heavy days recently";
  }

  if (mediumOrHigh >= 4) {
    return "frequent packed days lately";
  }

  return undefined;
}

function detectHighSignal(input: string): "POSITIVE" | "NEGATIVE" | "NEUTRAL" {
  const text = input.toLowerCase();
  const positiveWords = [
    "happy",
    "great",
    "amazing",
    "excited",
    "glad",
    "awesome",
    "fantastic",
    "wonderful",
    "good news",
  ];
  const negativeWords = [
    "tired",
    "exhausted",
    "overwhelmed",
    "alone",
    "frustrated",
    "drained",
    "worn out",
    "rough",
    "hard day",
  ];

  const positiveHits = positiveWords.filter((word) => text.includes(word)).length;
  const negativeHits = negativeWords.filter((word) => text.includes(word)).length;

  if (positiveHits > negativeHits) {
    return "POSITIVE";
  }
  if (negativeHits > positiveHits) {
    return "NEGATIVE";
  }
  return "NEUTRAL";
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: string; language?: string; history?: Array<{role: string, text: string}> };
    const text = body.text?.trim();
    const language = body.language?.trim();
    const history = body.history || [];

    if (!text) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }

    let stress: StressLevel = "MEDIUM";
    try {
      stress = await classifyStress(text);
    } catch (classificationError) {
      console.error(
        "[POST /api/chat] Stress classification failed, falling back to MEDIUM.",
        classificationError,
      );
    }
    const highSignal = stress === "HIGH" ? detectHighSignal(text) : undefined;
    const createdAt = new Date();

    let recentPattern: string | undefined;

    try {
      await connectToDatabase();
      await Message.create({
        text,
        stress,
        createdAt,
      });

      const recentMessages = await Message.find({}, { stress: 1, _id: 0 })
        .sort({ createdAt: -1 })
        .limit(8)
        .lean<Array<{ stress: StressLevel }>>();
      recentPattern = summarizeRecentPattern(recentMessages.map((item) => item.stress));
    } catch (dbError) {
      console.error("[POST /api/chat] Mongo write failed, using memory fallback.", dbError);
      addMemoryMessage({ text, stress, createdAt });
      const recentMemory = getMemoryHistory().slice(-8);
      recentPattern = summarizeRecentPattern(recentMemory.map((item) => item.stress));
    }

    let reply: string;
    try {
      reply = await generateReply(text, stress, recentPattern, highSignal, language, history);
    } catch {
      if (stress === "HIGH") {
        if (highSignal === "POSITIVE") {
          reply = "Nice to hear that, sounds like a really good day.";
        } else {
          reply = "That sounds like a lot for one day. If you can, take a short pause when it fits.";
        }
      } else if (stress === "MEDIUM") {
        reply = "Sounds like your day was pretty full with plenty to handle.";
      } else {
        reply = "Good to hear your day felt manageable overall.";
      }
    }

    return NextResponse.json({ reply, stress });
  } catch (error) {
    console.error("[POST /api/chat] Unhandled error.", error);
    return NextResponse.json(
      { error: "Something went wrong while handling your message." },
      { status: 500 },
    );
  }
}
