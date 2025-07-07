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
        id: 'AwsSolutions-L1',
        reason: 'Using default runtime version for development'
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Wildcard permissions are required for Lambda and Amplify functionality',
        appliesTo: [
          { regex: '/^Action::s3:.*\\*/' },
          { regex: '/^Resource::.*\\*/' }
        ]
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
        'sts:AssumeRole'
      ],
      resources: [`arn:aws:sts::${this.account}:role/AmplifyRole-*`] // Specify exact role pattern
    }));

    amplifyServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sso-oidc:CreateToken'
      ],
      resources: [`arn:aws:sso-oidc:${this.region}:${this.account}:instance/*`] // Specify instance
    }));

    amplifyServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'qbusiness:SearchRelevantContent'
      ],
      resources: [`arn:aws:qbusiness:${this.region}:${this.account}:content/*`] // Specify content
    }));

    // Create an S3 bucket to store the built files
    const deploymentBucket = new s3.Bucket(this, 'CrossAccuntDataRetrievalTester-DeploymentBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      serverAccessLogsPrefix: 'access-logs/',
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
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

    // Create the deployment role first
    const bucketDeploymentRole = new iam.Role(this, 'BucketDeploymentRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        'logs': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'logs:CreateLogGroup',
                'logs:CreateLogStream',
                'logs:PutLogEvents'
              ],
              resources: [
                `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/lambda/*`
              ]
            })
          ]
        }),
        's3': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
                's3:ListBucket'
              ],
              resources: [
                deploymentBucket.bucketArn,
                `${deploymentBucket.bucketArn}/*`
              ]
            })
          ]
        })
      }
    });

    const bucketDeployment = new s3Deploy.BucketDeployment(this, 'DeployFiles', {
      sources: [
        s3Deploy.Source.asset('../frontend/build', {
          bundling: {
            image: cdk.DockerImage.fromRegistry('alpine'),
            user: 'root',
            command: [
              'sh', '-c',
              'rm -f /asset-output/deployment.zip && apk add --no-cache zip && cp -r /asset-input/* /asset-output/ && cd /asset-output && zip -r deployment.zip *'
            ],
          },
        })
      ],
      destinationBucket: deploymentBucket,
      memoryLimit: 1024,
      role: bucketDeploymentRole
    });
    

    // Add S3 read permissions to the Amplify role
    amplifyServiceRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
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