#!/usr/bin/env node

import * as cdk from 'aws-cdk-lib';
import { EnterpriseStack } from '../lib/enterprise-stack';

const app = new cdk.App();


new EnterpriseStack(app, 'EnterpriseStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
})