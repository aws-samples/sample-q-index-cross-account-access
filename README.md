# Cross-Account Data Retrieval Tester for Amazon Q Business

## Overview

This React application demonstrates cross-account data retrieval functionality for Amazon Q index for ISV using AWS IAM Identity Center authentication. The application implements a step-by-step process for authentication, token generation, and data retrieval.

## Features

Multi-step authentication flow
AWS OIDC integration
STS credential management
Amazon Q Business data retrieval
Persistent form data storage
Interactive progress tracking

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
