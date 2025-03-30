#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { EnterpriseStack } from '../lib/enterprise-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { AwsSolutionsChecks } from 'cdk-nag';
import { Aspects } from 'aws-cdk-lib';

const app = new cdk.App();
Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }))


new EnterpriseStack(app, 'EnterpriseStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
})

new FrontendStack(app, 'FrontendStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
})