import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import { NagSuppressions } from 'cdk-nag';

export class EnterpriseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    //Nag suppressions at stack level all apply to a Custom Resource that is deployed under the hood
    NagSuppressions.addStackSuppressions(this, [{
      id: 'AwsSolutions-IAM4',
      reason: 'AWS Custom Resource requires Lambda basic execution role for CloudWatch logging'
    }])

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

    // Create the Lambda function role
    const ingestDummyDataRole = new iam.Role(this, 'ingestDummyDataRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        ['qBusinessPolicy']: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ['qbusiness:BatchPutDocument'],
              resources: [
                `arn:${cdk.Stack.of(this).partition}:qbusiness:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:application/*`
              ],
            }),
          ],
        }),
        ['cloudWatchPolicy']: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
              ],
              resources: [
                `arn:${cdk.Stack.of(this).partition}:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/lambda/*`
              ]
            })
          ]
        })
      }
    });

    // Create Lambda function
    const ingestDummyData = new lambda.Function(this, 'IngestDummyData', {
      code: lambda.Code.fromAsset('lib/lambda/ingestDummyData', {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            'bash', '-c',
            'pip install -r requirements.txt -t /asset-output && cp -au . /asset-output && chmod -R 755 /asset-output',
          ],
        },
      }),
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'index.handler',
      memorySize: 128,
      timeout: cdk.Duration.minutes(15),
      role: ingestDummyDataRole,
      environment: {
        ApplicationId: qBusinessApp.attrApplicationId,
        IndexId: qBusinessIndex.attrIndexId
      },
    });

    // Create the custom resource role without Lambda function reference
    const customResourceRole = new iam.Role(this, 'CustomResourceRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        ['cloudWatchPolicy']: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
              ],
              resources: [
                `arn:${cdk.Stack.of(this).partition}:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/lambda/*`
              ]
            })
          ]
        })
      }
    });

    // Add Lambda invoke permission after Lambda creation
    customResourceRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['lambda:InvokeFunction'],
        resources: [ingestDummyData.functionArn]
      })
    );

    // NAG suppressions
    NagSuppressions.addResourceSuppressions(ingestDummyDataRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard is required for BatchPutDocument operations across all documents in the Q Business index',
        appliesTo: [
          `Resource::arn:${cdk.Stack.of(this).partition}:qbusiness:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:application/*`
        ]
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Lambda function requires permissions to create and write to its CloudWatch log groups',
        appliesTo: [
          `Resource::arn:${cdk.Stack.of(this).partition}:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/lambda/*`
        ]
      }
    ]);

    // NAG suppressions for the CustomResourceRole
    NagSuppressions.addResourceSuppressions(customResourceRole, [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Custom Resource Lambda function requires permissions to create and write to its CloudWatch log groups',
        appliesTo: [
          `Resource::arn:${cdk.Stack.of(this).partition}:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/lambda/*`
        ]
      }
    ]);

    // Create custom resource with static physical ID
    const customResource = new cr.AwsCustomResource(this, 'IngestDummyDataCustomResource', {
      onCreate: {
        service: 'Lambda',
        action: 'invoke',
        physicalResourceId: cr.PhysicalResourceId.of('CustomResourceIngestDummyData-' + Math.random().toString(36).slice(2, 7)),
        parameters: {
          FunctionName: ingestDummyData.functionName,
          InvocationType: 'RequestResponse',
          Payload: '{}',
        },
        region: this.region,
      },
      role: customResourceRole,
      installLatestAwsSdk: false,
    });
    customResource.node.addDependency(ingestDummyData);
    customResource.node.addDependency(customResourceRole);

  }
}
