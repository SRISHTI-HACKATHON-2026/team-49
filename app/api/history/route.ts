import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import { getMemoryHistory } from "@/lib/memoryStore";
import Message from "@/models/Message";

export async function GET() {
  try {
    try {
      await connectToDatabase();

      const history = await Message.find({}, { _id: 0, text: 1, stress: 1, createdAt: 1 })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      return NextResponse.json({ messages: history.reverse() });
    } catch (dbError) {
      console.error("[GET /api/history] Mongo read failed, using memory fallback.", dbError);
      return NextResponse.json({ messages: getMemoryHistory() });
    }
  } catch (error) {
    console.error("[GET /api/history] Unhandled error.", error);
    return NextResponse.json({ error: "Unable to load message history." }, { status: 500 });
  }
}
