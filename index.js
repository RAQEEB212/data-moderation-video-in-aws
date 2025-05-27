import multer from "multer";
import fs from "fs";
import express from "express";
import cors from "cors";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { readFileSync } from "fs";
import path from "path";
import { CreateQueueCommand, GetQueueAttributesCommand, GetQueueUrlCommand,
    SetQueueAttributesCommand, DeleteQueueCommand, ReceiveMessageCommand, DeleteMessageCommand } from  "@aws-sdk/client-sqs";
import {CreateTopicCommand, SubscribeCommand, DeleteTopicCommand } from "@aws-sdk/client-sns";
import  { SQSClient } from "@aws-sdk/client-sqs";
import  { SNSClient } from "@aws-sdk/client-sns";
import  { RekognitionClient, StartContentModerationCommand, GetContentModerationCommand } from "@aws-sdk/client-rekognition";
import { stdout } from "process";
import {fromIni} from '@aws-sdk/credential-providers';

// Set the AWS Region.
const REGION = "us-east-1"; //e.g. "us-east-1"
const profileName = "RAQEEB212"
// Create SNS service object.
const sqsClient = new SQSClient({ region: REGION,
    credentials: fromIni({profile: profileName,}), });
const snsClient = new SNSClient({ region: REGION,
    credentials: fromIni({profile: profileName,}), });
const rekClient = new RekognitionClient({region: REGION,
    credentials: fromIni({profile: profileName,}),
});

const s3Client = new S3Client({
    region: REGION,
    credentials: fromIni({ profile: profileName }),
});

// Set bucket and video variables
const bucket = "video-moderation-sahoolat";
const videoName = "videoo.mp4";
const roleArn = "arn:aws:iam::067663914367:role/RekognitionSnsCustomRole";
var startJobId = "";

var ts = Date.now();
const snsTopicName = "AmazonRekognitionExample" + ts;
const snsTopicParams = {Name: snsTopicName}
const sqsQueueName = "AmazonRekognitionQueue-" + ts;

// Set the parameters
const sqsParams = {
    QueueName: sqsQueueName, //SQS_QUEUE_URL
    Attributes: {
        DelaySeconds: "60", // Number of seconds delay.
        MessageRetentionPeriod: "86400", // Number of seconds delay.
    },
};

const createTopicandQueue = async () => {
    try {
        // Create SNS topic
        const topicResponse = await snsClient.send(new CreateTopicCommand(snsTopicParams));
        const topicArn = topicResponse.TopicArn
        console.log("Success", topicResponse);
        // Create SQS Queue
        const sqsResponse = await sqsClient.send(new CreateQueueCommand(sqsParams));
        console.log("Success", sqsResponse);
        const sqsQueueCommand = await sqsClient.send(new GetQueueUrlCommand({QueueName: sqsQueueName}))
        const sqsQueueUrl = sqsQueueCommand.QueueUrl
        const attribsResponse = await sqsClient.send(new GetQueueAttributesCommand({QueueUrl: sqsQueueUrl, AttributeNames: ['QueueArn']}))
        const attribs = attribsResponse.Attributes
        console.log(attribs)
        const queueArn = attribs.QueueArn
        // subscribe SQS queue to SNS topic
        const subscribed = await snsClient.send(new SubscribeCommand({TopicArn: topicArn, Protocol:'sqs', Endpoint: queueArn}))
        const policy = {
            Version: "2012-10-17",
            Statement: [
                {
                    Sid: "MyPolicy",
                    Effect: "Allow",
                    Principal: {AWS: "*"},
                    Action: "SQS:SendMessage",
                    Resource: queueArn,
                    Condition: {
                        ArnEquals: {
                            'aws:SourceArn': topicArn
                        }
                    }
                }
            ]
        };

        const response = sqsClient.send(new SetQueueAttributesCommand({QueueUrl: sqsQueueUrl, Attributes: {Policy: JSON.stringify(policy)}}))
        console.log(response)
        console.log(sqsQueueUrl, topicArn)
        return [sqsQueueUrl, topicArn]

    } catch (err) {
        console.log("Error", err);
    }
};

const startModerationDetection = async (roleArn, snsTopicArn) => {
    try {
        const response = await rekClient.send(
            new StartContentModerationCommand({
                Video: { S3Object: { Bucket: bucket, Name: videoName } },
                NotificationChannel: { RoleArn: roleArn, SNSTopicArn: snsTopicArn },
            })
        );
        startJobId = response.JobId;
        console.log(`Moderation JobID: ${startJobId}`);
        return startJobId;
    } catch (err) {
        console.error("Error starting content moderation:", err);
    }
};

const getModerationResults = async (jobId) => {
    console.log("Fetching moderation results...");
    let paginationToken = '';
    let finished = false;

    while (!finished) {
        const response = await rekClient.send(
            new GetContentModerationCommand({
                JobId: jobId,
                NextToken: paginationToken,
                SortBy: "TIMESTAMP",
                MaxResults: 10,
            })
        );

        response.ModerationLabels.forEach((label) => {
            console.log(`Timestamp: ${label.Timestamp}`);
            console.log(`Confidence: ${label.ModerationLabel.Confidence}`);
            console.log(`Name: ${label.ModerationLabel.Name}`);
            console.log(`ParentName: ${label.ModerationLabel.ParentName}`);
            console.log();
        });

        if (response.NextToken) {
            paginationToken = response.NextToken;
        } else {
            finished = true;
        }
    }
};

// Checks for status of job completion
const getSQSMessageSuccess = async(sqsQueueUrl, startJobId) => {
    try {
        // Set job found and success status to false initially
        var jobFound = false
        var succeeded = false
        var dotLine = 0
        // while not found, continue to poll for response
        while (jobFound == false){
            var sqsReceivedResponse = await sqsClient.send(new ReceiveMessageCommand({QueueUrl:sqsQueueUrl,
                MaxNumberOfMessages:'ALL', MaxNumberOfMessages:10}));
            if (sqsReceivedResponse){
                var responseString = JSON.stringify(sqsReceivedResponse)
                if (!responseString.includes('Body')){
                    if (dotLine < 40) {
                        console.log('.')
                        dotLine = dotLine + 1
                    }else {
                        console.log('')
                        dotLine = 0
                    };
                    stdout.write('', () => {
                        console.log('');
                    });
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue
                }
            }

            // Once job found, log Job ID and return true if status is succeeded
            for (var message of sqsReceivedResponse.Messages){
                console.log("Retrieved messages:")
                var notification = JSON.parse(message.Body)
                var rekMessage = JSON.parse(notification.Message)
                var messageJobId = rekMessage.JobId
                if (String(rekMessage.JobId).includes(String(startJobId))){
                    console.log('Matching job found:')
                    console.log(rekMessage.JobId)
                    jobFound = true
                    console.log(rekMessage.Status)
                    if (String(rekMessage.Status).includes(String("SUCCEEDED"))){
                        succeeded = true
                        console.log("Job processing succeeded.")
                        var sqsDeleteMessage = await sqsClient.send(new DeleteMessageCommand({QueueUrl:sqsQueueUrl, ReceiptHandle:message.ReceiptHandle}));
                    }
                }else{
                    console.log("Provided Job ID did not match returned ID.")
                    var sqsDeleteMessage = await sqsClient.send(new DeleteMessageCommand({QueueUrl:sqsQueueUrl, ReceiptHandle:message.ReceiptHandle}));
                }
            }
        }
        return succeeded
    } catch(err) {
        console.log("Error", err);
    }
};

// Start label detection job, sent status notification, check for success status
// Retrieve results if status is "SUCEEDED", delete notification queue and topic
const runLabelDetectionAndGetResults = async () => {
    try {
        const sqsAndTopic = await createTopicandQueue();
        const startModerationRes = await startModerationDetection(roleArn, sqsAndTopic[1]);
        const getSQSMessageStatus = await getSQSMessageSuccess(sqsAndTopic[0], startModerationRes);
        if (getSQSMessageStatus) {
            await getModerationResults(startModerationRes);
        }
        const deleteQueue = await sqsClient.send(new DeleteQueueCommand({QueueUrl: sqsAndTopic[0]}));
        const deleteTopic = await snsClient.send(new DeleteTopicCommand({TopicArn: sqsAndTopic[1]}));
        console.log("Successfully deleted.")
    } catch (err) {
        console.log("Error", err);
    }
};

const uploadVideoToS3 = async () => {
    const filePath = path.resolve("video-sample.mp4"); // Adjust filename if needed
    const fileContent = readFileSync(filePath);

    const uploadParams = {
        Bucket: bucket,
        Key: videoName,
        Body: fileContent,
        ContentType: "video/mp4"
    };

    try {
        const uploadResult = await s3Client.send(new PutObjectCommand(uploadParams));
        console.log("✅ Video uploaded to S3 successfully.");
    } catch (err) {
        console.error("❌ Error uploading video to S3:", err);
        throw err;
    }
};

const runEverything = async () => {
    await uploadVideoToS3();
    await runLabelDetectionAndGetResults();
};

// Express server setup
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });
const PORT = 3000;

// API endpoint to trigger video analysis
app.post("/analyze", async (req, res) => {
    try {
        await uploadVideoToS3();
        await runLabelDetectionAndGetResults();
        res.status(200).json({ message: "Video analysis started and completed. Check logs for details." });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to process video." });
    }
});

app.post("/upload-analyze", upload.single("video"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No video file uploaded." });
        }

        // Read the uploaded file
        const filePath = req.file.path;
        const fileContent = fs.readFileSync(filePath);

        const uploadParams = {
            Bucket: bucket,
            Key: videoName,
            Body: fileContent,
            ContentType: "video/mp4"
        };

        await s3Client.send(new PutObjectCommand(uploadParams));
        console.log("✅ Uploaded video from POST request to S3.");

        // --- Moderation and verdict logic ---
        const sqsAndTopic = await createTopicandQueue();
        const startModerationRes = await startModerationDetection(roleArn, sqsAndTopic[1]);
        const getSQSMessageStatus = await getSQSMessageSuccess(sqsAndTopic[0], startModerationRes);
        let unsafeFindings = [];

        if (getSQSMessageStatus) {
            let paginationToken = '';
            let finished = false;

            while (!finished) {
                const response = await rekClient.send(
                    new GetContentModerationCommand({
                        JobId: startModerationRes,
                        NextToken: paginationToken,
                        SortBy: "TIMESTAMP",
                        MaxResults: 10,
                    })
                );

                const UNSAFE_LABELS = [
                    "Explicit Nudity", "Nudity", "Sexual Activity",
                    "Violence", "Physical Abuse", "Gore", "Drugs",
                    "Drinking", "Smoking", "Hate Symbols"
                ];
                const MIN_CONFIDENCE = 70;

                response.ModerationLabels.forEach((label) => {
                    const name = label.ModerationLabel.Name;
                    const confidence = label.ModerationLabel.Confidence;

                    if (UNSAFE_LABELS.includes(name) && confidence >= MIN_CONFIDENCE) {
                        unsafeFindings.push({ name, confidence, timestamp: label.Timestamp });
                    }
                });

                if (response.NextToken) {
                    paginationToken = response.NextToken;
                } else {
                    finished = true;
                }
            }
        }

        fs.unlinkSync(filePath); // cleanup local temp file
        await sqsClient.send(new DeleteQueueCommand({QueueUrl: sqsAndTopic[0]}));
        await snsClient.send(new DeleteTopicCommand({TopicArn: sqsAndTopic[1]}));
        console.log("Successfully deleted.");

        if (unsafeFindings.length > 0) {
            return res.status(200).json({
                verdict: "Unsafe",
                reasons: unsafeFindings,
                message: "This video contains content that is not allowed on the website."
            });
        } else {
            return res.status(200).json({
                verdict: "Safe",
                message: "This video is safe to display."
            });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to upload and analyze video." });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// runEverything();