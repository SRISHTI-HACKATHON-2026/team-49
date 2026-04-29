import { Schema, model, models } from "mongoose";

export interface UserDocument {
  email: string; // Since we are using Firebase Auth, email is a good unique identifier
  name?: string;
  role: "informal" | "formal";
  interests?: string[];
  doctorEmail?: string;
  createdAt: Date;
}

const UserSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
    },
    role: {
      type: String,
      enum: ["informal", "formal"],
      required: true,
    },
    interests: {
      type: [String],
      default: [],
    },
    doctorEmail: {
      type: String,
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
  }
);

const User = models.User || model<UserDocument>("User", UserSchema, "users");

export default User;
