import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";


export class EnterpriseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Parameter for Identity Center Instance ARN
    const identityCenterInstanceArn = new cdk.CfnParameter(this, 'IdentityCenterInstanceArn', {
      type: 'String',
      description: 'ARN of the IAM Identity Center instance',
    });

    // Create Q Business Application
    const qBusinessApp = new cdk.aws_qbusiness.CfnApplication(this, 'QBusinessApplication', {
      displayName: 'MyCDKQBusinessApp',
      identityCenterInstanceArn: identityCenterInstanceArn.valueAsString,
    });

    // Create Q Business Index
    const qBusinessIndex = new cdk.aws_qbusiness.CfnIndex(this, 'QBusinessIndex', {
      applicationId: qBusinessApp.attrApplicationId,
      displayName: 'MyIndex',
      type: 'STARTER',
      capacityConfiguration: {
        units: 1
      }
    });

    // Create Q Business Retriever
    const qBusinessRetriever = new cdk.aws_qbusiness.CfnRetriever(this, 'QBusinessRetriever', {
      applicationId: qBusinessApp.attrApplicationId,
      displayName: 'MyRetriever',
      type: 'NATIVE_INDEX',
      configuration: {
        nativeIndexConfiguration: {
          indexId: qBusinessIndex.attrIndexId
        }
      }
    });

    // Output the Application ID and Retriever ID
    new cdk.CfnOutput(this, 'QBusinessApplicationId', {
      description: 'Amazon Q Business Application ID',
      value: qBusinessApp.attrApplicationId
    });

    new cdk.CfnOutput(this, 'QBusinessRetrieverId', {
      description: 'Amazon Q Business Retriever ID',
      value: qBusinessRetriever.attrRetrieverId
    });

    new cdk.CfnOutput(this, 'QBusinessIndexId', {
      description: 'Amazon Q Business Index ID',
      value: qBusinessIndex.attrIndexId
    });

    // Create IAM Role for Lambda
    const ingestDummyDataRole = new iam.Role(this, 'ingestDummyDataRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
          ['qBusinessPolicy']: new iam.PolicyDocument({
          statements: [
              new iam.PolicyStatement({
              actions: ['qbusiness:BatchPutDocument'],
              resources: ['*'],
              }),
          ],
          }),
      },
      managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AWSLambdaBasicExecutionRole',
          ),
      ],
    });

    // Create Lambda function to start Glue Crawler. The Glue Crawler is created in the stack above. 
    const ingestDummyData = new lambda.Function(this, 'IngestDummyData', {
        code: lambda.Code.fromAsset('lib/lambda/ingestDummyData', {
          bundling: {
            image: lambda.Runtime.PYTHON_3_11.bundlingImage,
            command: [
                'bash', '-c',
                'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output && chmod -R 755 /asset-output',
            ],
          },
        }),
        runtime: lambda.Runtime.PYTHON_3_11,
        handler: 'index.handler',
        memorySize: 128,
        timeout: cdk.Duration.minutes(15),
        role: ingestDummyDataRole,
        environment: { 
          ApplicationId: qBusinessApp.attrApplicationId,
          IndexId: qBusinessIndex.attrIndexId
        },
    });

    // Define the custom resource to invoke the Lambda function
    const customResource = new cr.AwsCustomResource(this, 'IngestDummyDataCustomResource', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        physicalResourceId: cr.PhysicalResourceId.of('IngestDummyData'),
        parameters: {
          FunctionName: ingestDummyData.functionName,
          InvocationType: 'RequestResponse',
          Payload: '{}',
        },
        region: this.region, 
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [ingestDummyData.functionArn],
            effect: iam.Effect.ALLOW,
          }),
      ]),
      installLatestAwsSdk: false,
    });
    customResource.node.addDependency(ingestDummyData);

  }
}
