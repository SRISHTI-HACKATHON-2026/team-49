import { Schema, model, models } from "mongoose";

export type StressLevel = "LOW" | "MEDIUM" | "HIGH";

export interface MessageDocument {
  text: string;
  stress: StressLevel;
  sleep?: string;
  createdAt: Date;
}

const MessageSchema = new Schema<MessageDocument>(
  {
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },
    stress: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      required: true,
    },
    sleep: {
      type: String,
      enum: ["GOOD", "POOR"],
      required: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
  },
  {
    versionKey: false,
  },
);

const existingModel = models.Message;
const hasStressPath = existingModel?.schema?.path("stress");

// In Next.js dev, HMR can keep an old model compiled with previous schema fields.
// If the cached model does not match the current schema, recompile it.
if (existingModel && !hasStressPath) {
  delete models.Message;
}

const Message = models.Message || model<MessageDocument>("Message", MessageSchema, "messages");

export default Message;
