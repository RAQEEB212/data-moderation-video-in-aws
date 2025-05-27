

import { StartContentModerationCommand } from "@aws-sdk/client-rekognition";
import { rekognitionClient } from "./utils/client.js";
import dotenv from "dotenv";
dotenv.config();

export async function startModerationJob() {
  const command = new StartContentModerationCommand({
    Video: {
      S3Object: {
        Bucket: process.env.VIDEO_BUCKET,
        Name: process.env.VIDEO_FILE,
      },
    },
    MinConfidence: parseInt(process.env.MIN_CONFIDENCE || "70"),
    NotificationChannel: {
      SNSTopicArn: process.env.SNS_TOPIC_ARN,
      RoleArn: process.env.ROLE_ARN,
    },
    JobTag: process.env.JOB_TAG || "default-moderation-job",
  });

  const response = await rekognitionClient.send(command);
  return response.JobId;
}