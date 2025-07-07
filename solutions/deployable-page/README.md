# Deployable Sample ISV webpage to access Q index

## Features

- Deploy locally (or option to deploy and host via AWS Amplify with CDK) Cross-Account Data Retrieval Tester application in ISV environment which helps demonstrate the user authentication, token generation and credential retrieval to make Search Content Retrieval (SRC) API call. The application then leverages SRC index responses with Bedrock LLM models to generate summarization output. You can easily switch with different LLM models to see the different outputs.
- [optional] CDK helps deploy Amazon Q Business with assigned IAM IDC instance you prepared and ingests a sample data to test with. This step is not required with you have Amazon Q Business application already running with IAM IDC as access management.

![Feature](assets/feature-image.png)

## Prerequisites

- Node (v18) and NPM (v8.19) installed and configured on your computer
- AWS CLI (v2) installed and configured on your computer
- AWS CDK (v2) installed and configured on your computer (if running CDK to deploy Amazon Q Business)

- Two AWS Accounts (one account as ISV running this tester application, another account acting as enterprise customer running Amazon Q Business)
- Data accessor registered for your ISV and make sure to add https://localhost:8081 as one of the redirect URLs ([see details from this related blogpost - Enhance enterprise productivity for your LLM solution by becoming an Amazon Q Business data accessor](https://aws.amazon.com/blogs/machine-learning/enhance-enterprise-productivity-for-your-llm-solution-by-becoming-an-amazon-q-business-data-accessor/))
- IAM Identity Center (IDC) instance setup with user added on enterprise customer AWS account
- Amazon Q Business application setup with IAM IDC as access management on enterprise customer AWS account [optional - CDK deployment for easy setup]
- Docker installed (for deploying CDK only; used for packaging python libraries to Lambda function)

## Key Components

The key component of this solution is to show the user authentication flow step-by-step (OIDC authentication with AWS IAM Identity Center, token generation and management, STS credential handling) required to make Amazon Q Business's [SearchRelevantContent API](https://docs.aws.amazon.com/amazonq/latest/api-reference/API_SearchRelevantContent.html) requests to cross-account Q index on customer's environment.

![User Authentication Flow](assets/authentication-flow.png)

This flow illustrates user authentication process in order for ISV application to make SearchRelevantContent API to access customer's Q index that this frontend solution demonstrates in steps.

## Deployment Steps

### Amazon Q Business deployment (CDK) on customer environment

This is an optional step if you need Amazon Q Business deployment with sample data inserted into the Q index automatically. Instead you can manually set this Q index by deploying Amazon Q Business with IAM IDC in your customer environment AWS account. 

This step assumes you already have IAM Identity Center (IDC) instance setup on your customer environment AWS account. For instructions how to setup IAM IDC, ((see here)[https://docs.aws.amazon.com/singlesignon/latest/userguide/enable-identity-center.html]).

1. In your terminal navigate to `cross-account-qindex-demo/cdk-stacks`
2. Run `npm install`
3. If you have started with a new environment, run bootstrap CDK: `cdk bootstrap`
4. Deploy the CDK Stack
- Run the script: 
```
cdk deploy EnterpriseStack --parameters IdentityCenterInstanceArn=<<insert your IDC instance ARN>>
```
To find your IDC instance ARN, go to AWS Management Console and navigate to IAM Identity Center > Settings
![IDC Settings](assets/IDC-Setting.png)

**Note:** If you are seeing CDK deployment errors, re-confirm IDC instance ARN is correct and your AWS credentials that you are using to deploy CDK is from AWS account on customer environment.

5. Wait for all resources to be provisioned before continuing to the next step
6. Navigate to Amazon Q Business application that was just created and click on `Manage user access`
![User Management](assets/qbusiness-user-management.png)
7. Select `Add groups and users` and search for the user or group from IAM IDC that you want to add for this

### Setup data accessor (ISV) in Amazon Q Business on customer environment

1. Navigate to your Amazon Q Business application on AWS Management console 
2. Select `Data accessors` from the left menu, and select `Add data accessor`
3. Select your data accessor from the list (If you don't have your ISV application registered as data accessor, (follow this post on the steps[https://aws.amazon.com/blogs/machine-learning/enhance-enterprise-productivity-for-your-llm-solution-by-becoming-an-amazon-q-business-data-accessor/]))
![Data Accessor](assets/data-accessor-setup.png)
4. Select `All users with application access` on User access
![Data Accessor Setting](assets/data-accessor-setup2.png)
5. Once your data accessor is added, you will see the parameter details on the screen. Note these values as you will need these values in the next step
![Data Accessor Details](assets/data-accessor-setup3.png)

### Frontend deployment on ISV environment

**Note** These instructions assume you have completed all the prerequisites and for your data accessor you have `https://localhost:8081` added as one of the redirect URIs.

1. Clone the solution to your computer (using `git clone`)

2. Set AWS credentials of your AWS account for ISV environment
    - In your terminal, navigate to `cross-account-qindex-demo/frontend`
    - Create .env.local file by `vi .env.local` and enter environment variables in the following format
```
REACT_APP_AWS_ACCESS_KEY_ID=<<replace with your AWS_ACCESS_KEY_ID>>
REACT_APP_AWS_SECRET_ACCESS_KEY=<<replace with your AWS_SECRET_ACCESS_KEY>>
REACT_APP_AWS_SESSION_TOKEN=<<replace with your AWS_SESSION_TOKEN>>
```

3. Deploy and run the frontend in your local host
    - In your terminal, navigate to `cross-account-qindex-demo/frontend`
    - Run `npm install` & `npm run build`
    - Run `npm start` which will run the server in `https://localhost:8081`

#### [Optional] Deploy the frontend through AWS Amplify

**Note:** You will need to request the Amplify's deployed url to be added in the data accessor registration in order to make this work. Another option is to use custom domain applied to your Amplify endpoint to make this url registration added to your data accessor easier.

1. In your terminal, navigate to `cross-account-qindex-demo/cdk-stack`
2. Run `npm install`
3. Run `cdk deploy FrontendStack`
4. Once deployed, find the value of `FrontendStack.AmplifyDeployCommand` from the CDK output and run it. It should be formatted like this, `aws amplify start-deployment --app-id <your app id> --branch-name main --source-url s3://<your S3 bucket>/deployment.zip`
6. Open the URL from the CDK output `FrontendStack.AmplifyAppURL`


## Usage

1. Navigate to `https://localhost:8081`

2. Insert the details on each field and click `Authorize`
    - ISV Provided Details
        - **IAM Role ARN** - This is the IAM role created by ISV when registering for data accessor
        - **Redirect URL** - Enter `https://localhost:8081` for this demo
    - Enterprise Customer Provided Details
        - **Amazon Q Business application ID** - Go to enabled data accessor page on AWS Management Console to find this information
        - **Amazon Q Business applicagion Region** - Go to enabled data accessor page on AWS Management Console to find this information
        - **Amazon Q Business retriever ID** - Go to enabled data accessor page on AWS Management Console to find this information
        - **Data accessor application ID** - Go to enabled data accessor page on AWS Management Console to find this information
        - **Region for the IAM Identity Enter instance** - Go to enabled data accessor page on AWS Management Console to find this information
![Frontend UI](assets/frontend-ui1.png)

3. Confirm each steps 2 - 4 have been generated successful and enter prompt in Step 5 to get index results

![Frontend UI Search](assets/frontend-ui2.png)

4. [optional] Add more sources to your Amazon Q Business through different connectors to be able to get more variety of index results

## Clean Up

To remove the solution from your account, please follow these steps:

1. Remove CDK Stacks
    - In your terminal, navigate to appfabric-data-analytics/cdk-stacks
    - Run `cdk destroy --all`

# Authors

- [Takeshi Kobayashi](https://www.linkedin.com/in/takeshikobayashi/)
- [Siddhant Gupta](https://www.linkedin.com/in/siddhant-gupta-a43a7b53/)
- [Akhilesh Amara](https://www.linkedin.com/in/akhilesh-amara/)

# License

This library is licensed under the MIT-0 License. See the LICENSE file.

- [Changelog](CHANGELOG.md) of the project.
- [License](LICENSE) of the project.
- [Code of Conduct](CODE_OF_CONDUCT.md) of the project.

## Using This In Production

It is critical that before you use any of this code in Production that you work with your own internal Security and Governance teams to get the appropriate Code and AppSec reviews for your organization. 

Although the code has been written with best practices in mind, your own company may require different ones, or have additional rules and restrictions.

You take full ownership and responsibility for the code running in your environment, and are free to make whatever changes you need to.