# Cross-Account Data Retrieval Tester for Amazon Q index

## Overview

This CDK application demonstrates cross-account data retrieval functionality for Amazon Q index using AWS IAM Identity Center (IDC) authentication setup on Amazon Q Business. The application implements a step-by-step process for authentication, token generation, and data retrieval through Search Content Retrieval API.

![Overall Architecture](assets/overall-architecture.png)

## Features

- CDK deploys Cross-Account Data Retrieval Tester application in ISV environment which helps demonstrate the user authentication, token generation and credential retrieval to make Search Content Retrieval API call.
- [optional] CDK helps deploy Amazon Q Business with assigned IAM IDC instance you prepared and ingests a sample data to test with. This step is not required with you have Amazon Q Business application already running with IAM IDC as access management.

## Prerequisites

- Node (v18) and NPM (v8.19) installed and configured on your computer
- AWS CLI (v2) installed and configured on your computer
- AWS CDK (v2) installed and configured on your computer (if running CDK to deploy Amazon Q Business)

- Two AWS Accounts (one acting as ISV, another acting as enterprise customer)
- Data accessor registered for your ISV [see details on the process](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/isv-info-to-provide.html)

## Key Components

1. Authentication Flow

    OIDC authentication with AWS IAM Identity Center
    Token generation and management
    STS credential handling

2. Main Features

    Form data persistence using localStorage
    Step-by-step progress tracking
    Error handling for each authentication step
    Secure credential display
    Search functionality for Amazon Q Business content

3. State Management

    Authentication state tracking
    Form data management
    Error state handling
    Search results storage

## Deployment Steps

cdk deploy EnterpriseStack --parameters IdentityCenterInstanceArn=arn:aws:sso:::instance/ssoins-18085ee3c45c8716
