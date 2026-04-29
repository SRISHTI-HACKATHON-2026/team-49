import type { StressLevel } from "@/models/Message";

export type StoredMessage = {
  text: string;
  stress: StressLevel;
  createdAt: Date;
};

const memoryMessages: StoredMessage[] = [];
const MAX_MESSAGES = 10;

export function addMemoryMessage(message: StoredMessage) {
  memoryMessages.push(message);
  if (memoryMessages.length > MAX_MESSAGES) {
    memoryMessages.splice(0, memoryMessages.length - MAX_MESSAGES);
  }
}

export function getMemoryHistory() {
  return [...memoryMessages];
}
