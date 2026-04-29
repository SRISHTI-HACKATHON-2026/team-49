import mongoose from "mongoose";

declare global {
  var mongooseConnection:
    | {
        conn: typeof mongoose | null;
        promise: Promise<typeof mongoose> | null;
        lastFailureAt: number;
        lastErrorMessage: string | null;
      }
    | undefined;
}

const cached = global.mongooseConnection ?? {
  conn: null,
  promise: null,
  lastFailureAt: 0,
  lastErrorMessage: null,
};

if (!global.mongooseConnection) {
  global.mongooseConnection = cached;
}

export async function connectToDatabase() {
  const mongodbUri = process.env.MONGODB_URI;
  if (!mongodbUri) {
    throw new Error("MONGODB_URI is not set.");
  }

  if (cached.conn) {
    return cached.conn;
  }

  const RETRY_COOLDOWN_MS = 30_000;
  const now = Date.now();
  if (cached.lastFailureAt && now - cached.lastFailureAt < RETRY_COOLDOWN_MS) {
    const reason = cached.lastErrorMessage ?? "recent connection failure";
    throw new Error(`Mongo retry cooldown active: ${reason}`);
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(mongodbUri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      socketTimeoutMS: 20000,
      maxPoolSize: 5,
      minPoolSize: 0,
      family: 4,
    });
  }

  try {
    cached.conn = await cached.promise;
    cached.lastFailureAt = 0;
    cached.lastErrorMessage = null;
    return cached.conn;
  } catch (error) {
    cached.promise = null;
    cached.conn = null;
    cached.lastFailureAt = Date.now();
    cached.lastErrorMessage = error instanceof Error ? error.message : "unknown error";
    throw error;
  }
}
