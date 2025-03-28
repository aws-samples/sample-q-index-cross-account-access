import * as cdk from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NagSuppressions } from 'cdk-nag';

export class FrontendStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Add suppressions after creating the resources
    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-S1',
        reason: 'Development environment - server access logs not required'
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'Development environment - SSL requirement temporarily disabled'
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Development environment - IAM permissions to be tightened later'
      },
      {
        id: 'AwsSolutions-CB4',
        reason: 'Development environment - KMS encryption to be added later'
      },
      {
        id: 'AwsSolutions-IAM4',
        reason: 'Lambda requires basic execution role for CloudWatch logs'
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'Using default runtime version for development'
      }
    ]);

    // Create IAM role for Amplify
    const amplifyServiceRole = new iam.Role(this, 'CrossAccuntDataRetrievalTester-AmplifyServiceRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      description: 'Role for Amplify to access AWS services',
    });

    // Add required policies
    amplifyServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sts:AssumeRole',
        'sso-oidc:CreateToken',
        'qbusiness:SearchRelevantContent'
      ],
      resources: ['*'], // You should restrict this to specific resources in production
    }));    

    // Create an S3 bucket to store the built files
    const deploymentBucket = new s3.Bucket(this, 'CrossAccuntDataRetrievalTester-DeploymentBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Add bucket policy for Amplify access
    const amplifyAccessPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:GetObjectVersion'],
      resources: [
        `${deploymentBucket.bucketArn}/*`,
        deploymentBucket.bucketArn
      ],
      principals: [
        new iam.ServicePrincipal('amplify.amazonaws.com')
      ]
    });

    deploymentBucket.addToResourcePolicy(amplifyAccessPolicy);

    const bucketDeployment = new s3Deploy.BucketDeployment(this, 'DeployFiles', {
      sources: [
        s3Deploy.Source.asset('../frontend/build', {
          bundling: {
            image: cdk.DockerImage.fromRegistry('alpine'),
            user: 'root',
            command: [
              'sh', '-c',
              'apk add --no-cache zip && cp -r /asset-input/* /asset-output/ && cd /asset-output && zip -r deployment.zip *'
            ],
          },
        })
      ],
      destinationBucket: deploymentBucket,
      memoryLimit: 1024,
    });
    

    // Add S3 read permissions to the Amplify role
    amplifyServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'amplify:*',
        'cloudfront:CreateInvalidation',
        's3:GetObject',
        's3:GetObjectVersion',
        's3:ListBucket',
        's3:PutObject',
        's3:DeleteObject'
      ],
      resources: [
        deploymentBucket.bucketArn,
        `${deploymentBucket.bucketArn}/*`
      ]
    }));
    

    // Create Amplify App
    const amplifyApp = new amplify.CfnApp(this, 'CrossAccuntDataRetrievalTester-App', {
      name: 'CrossAccuntDataRetrievalTester-App',
      platform: 'WEB',
      iamServiceRole: amplifyServiceRole.roleArn,
      environmentVariables: [
        {
          name: '_LIVE_UPDATES',
          value: JSON.stringify([
            { name: 'frontend', pkg: 'dist', type: 'web' }
          ])
        }
      ],
      buildSpec: JSON.stringify({
        version: 1,
        frontend: {
          phases: {
            preBuild: {
              commands: [
                'npm ci'  // or 'yarn install' depending on your package manager
              ]
            },
            build: {
              commands: [
                'mkdir -p ./website',
                `aws s3 cp s3://${deploymentBucket.bucketName}/deployment.zip ./deployment.zip`,
                'unzip deployment.zip -d ./website/'
              ]
            }
          },
          artifacts: {
            baseDirectory: './website',
            files: [
              '**/*'
            ]
          },
          cache: {
            paths: [
              'node_modules/**/*'
            ]
          }
        }
      }),
      customRules: [
        {
          source: '</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|ttf|map|json)$)([^.]+$)/>',
          target: '/index.html',
          status: '200'
        }
      ]
    });

    // Create branch configuration
    const mainBranch = new amplify.CfnBranch(this, 'MainBranch', {
      appId: amplifyApp.attrAppId,
      branchName: 'main',
      enableAutoBuild: true,
      stage: 'PRODUCTION',
      environmentVariables: [
        {
          name: 'AMPLIFY_MONOREPO_APP_ROOT',
          value: '/'
        },
        {
          name: 'AMPLIFY_DIFF_DEPLOY',
          value: 'false'
        },
        {
          name: 'TRIGGER_BUILD',
          value: Date.now().toString() // This will force a new build each time
        }
      ]
    });
    // Ensure proper dependency
    mainBranch.node.addDependency(bucketDeployment);

    new cdk.CfnOutput(this, 'S3Bucket', {
      value: deploymentBucket.bucketName,
      description: 'S3 Bucket Name'
    });

    new cdk.CfnOutput(this, 'AmplifyAppURL', {
      value: `https://${mainBranch.attrBranchName}.${amplifyApp.attrDefaultDomain}`,
      description: 'Amplify Application URL'
    });

    new cdk.CfnOutput(this, 'AmplifyDeployCommand', {
      value: `aws amplify start-deployment --app-id ${amplifyApp.attrAppId} --branch-name ${mainBranch.attrBranchName} --source-url s3://${deploymentBucket.bucketName}/deployment.zip`,
      description: 'Amplify Deploy Command'
    });
  }
}