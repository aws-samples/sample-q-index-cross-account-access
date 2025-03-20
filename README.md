# Cross-Account Data Retrieval Tester for Amazon Q index

## Overview

This CDK application demonstrates cross-account data retrieval functionality for Amazon Q index using AWS IAM Identity Center (IDC) authentication setup on Amazon Q Business. The application implements a step-by-step process for authentication, token generation, and data retrieval through Search Content Retrieval API.

![Overall Architecture](assets/overall-architecture.png)

## Features

- CDK deploys Cross-Account Data Retrieval Tester application in ISV environment which helps demonstrate the user authentication, token generation and credential retrieval to make Search Content Retrieval API call.
- [optional] CDK helps deploy Amazon Q Business for 

## Prerequisites

Node.js and npm installed
AWS account with appropriate permissions
Amazon Q Business application setup
Required AWS credentials and configurations

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
