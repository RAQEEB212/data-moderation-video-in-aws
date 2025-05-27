import { GetContentModerationCommand } from "@aws-sdk/client-rekognition";
import { rekognitionClient } from "./utils/client.js";
import dotenv from "dotenv";
dotenv.config();

export async function getModerationResults(jobId) {
  const command = new GetContentModerationCommand({
    JobId: jobId,
    SortBy: "TIMESTAMP",
    MaxResults: 1000,
  });

  const response = await rekognitionClient.send(command);
  const labels = response.ModerationLabels;

  if (!labels || labels.length === 0) {
    console.log("✅ No moderation labels found.");
    return;
  }

  console.log("🚨 Moderation Labels Detected:");
  for (const item of labels) {
    const { Timestamp, ModerationLabel } = item;
    console.log(`[${Timestamp} ms] ${ModerationLabel.Name} (${ModerationLabel.Confidence.toFixed(1)}%)`);
  }
}
