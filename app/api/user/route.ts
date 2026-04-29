import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import User from "@/models/User";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    await connectToDatabase();
    const user = await User.findOne({ email }).lean() as { role?: string, interests?: string[] } | null;

    return NextResponse.json({ role: user?.role || null, interests: user?.interests || null });
  } catch (error) {
    console.error("[GET /api/user] Failed to fetch user", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, role, name, interests } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    await connectToDatabase();
    
    // Construct update payload dynamically
    const updatePayload: any = { email };
    if (name) updatePayload.name = name;
    if (role) {
      if (!["informal", "formal"].includes(role)) {
        return NextResponse.json({ error: "Invalid role" }, { status: 400 });
      }
      updatePayload.role = role;
    }
    if (interests && Array.isArray(interests)) {
      updatePayload.interests = interests;
    }

    // Upsert user
    const user = await User.findOneAndUpdate(
      { email },
      { $set: updatePayload, $setOnInsert: { createdAt: new Date() } },
      { upsert: true, new: true }
    ).lean() as { role?: string, interests?: string[] };

    return NextResponse.json({ success: true, role: user.role, interests: user.interests });
  } catch (error) {
    console.error("[POST /api/user] Failed to update user", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
