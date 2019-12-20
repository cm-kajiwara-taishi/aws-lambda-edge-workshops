const AWS = require('aws-sdk');
const s3 = new AWS.S3({region: 'us-east-1'});
const ddb = new AWS.DynamoDB({region: 'us-east-1', apiVersion: '2012-10-08'});
const cfn = require('./cfn-response');

const {promisify} = require('util');
const cfnSend = promisify(cfn.send);

exports.handler = async (event, context) => {
    console.log('event: ' + JSON.stringify(event, null, 2));
    console.log('context: ' + JSON.stringify(context, null, 2));
    try {
        if (event.RequestType == 'Create' || event.RequestType == 'Update') {
            await Promise.all([bootstrapS3(event), bootstrapDDB(event)]);
        } else if (event.RequestType == 'Delete') {
            await Promise.all([cleanupS3(event)]);
        }
        await cfnSend(event, context, cfn.SUCCESS);
    } catch (err) {
        console.log(err);
        await cfnSend(event, context, cfn.FAILED, err);
    }
};

async function bootstrapS3(event) {
    const srcBucket = event.ResourceProperties.SrcS3Bucket;
    const dstBucket = event.ResourceProperties.DstS3Bucket;
    let objects = await s3.listObjects({ Bucket: srcBucket }).promise();
    await Promise.all(
        objects.Contents
        .map(obj => { return obj.Key; })
        .filter(key => { return !key.startsWith('bootstrap'); })
        .map(async key => {
            console.log(`getting ${key}`);
            let data = await s3.getObject({
                Bucket: srcBucket, Key: key
            }).promise();
            console.log(`copying ${data.ContentLength} bytes of ${key}`);
            await s3.putObject({
                Bucket: dstBucket, Key: key, 
                Body: data.Body, ContentType: data.ContentType
            }).promise();
        })
    );
}

async function cleanupS3(event) {
    const dstBucket = event.ResourceProperties.DstS3Bucket;
    let objects = await s3.listObjects({ Bucket: dstBucket }).promise();
    await Promise.all(
        objects.Contents
        .map(obj => { return obj.Key; })
        .map(async key => {
            console.log(`deleting ${key}`);
            let data = await s3.deleteObject({
                Bucket: dstBucket, Key: key
            }).promise();
        })
    );
}

async function bootstrapDDB(event) {
    const srcBucket = event.ResourceProperties.SrcS3Bucket;
    const ddbTableName = event.ResourceProperties.DdbTableName;
    let data = await s3.getObject({ 
        Bucket: srcBucket, Key: 'bootstrap/cards.json'
    }).promise();
    await Promise.all(
        JSON.parse(data.Body)
        .map(card => 
            ddb.putItem({
                TableName: ddbTableName,
                Item: { 
                    CardId: { 'S': card.CardId }, 
                    Description: { 'S': card.Description }, 
                    Likes: { 'N': '0' } 
                }
            }).promise()
        )
    );
}