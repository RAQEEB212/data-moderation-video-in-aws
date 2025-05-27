import { RekognitionClient } from "@aws-sdk/client-rekognition";
import dotenv from "dotenv";
dotenv.config();

export const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION,
});
