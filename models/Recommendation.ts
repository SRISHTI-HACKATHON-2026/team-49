import { Schema, model, models } from "mongoose";

export interface RecommendationDocument {
  role: "informal" | "formal";
  stress: "MEDIUM" | "HIGH";
  suggestions: string[];
}

const RecommendationSchema = new Schema<RecommendationDocument>(
  {
    role: {
      type: String,
      enum: ["informal", "formal"],
      required: true,
    },
    stress: {
      type: String,
      enum: ["MEDIUM", "HIGH"],
      required: true,
    },
    suggestions: {
      type: [String],
      required: true,
    },
  },
  {
    versionKey: false,
  }
);

const Recommendation = models.Recommendation || model<RecommendationDocument>("Recommendation", RecommendationSchema, "recommendations");

export default Recommendation;
