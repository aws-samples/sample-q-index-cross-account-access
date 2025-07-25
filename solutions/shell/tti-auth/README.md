# Shell script

This shell script by using AWS CLI goes through neccessary [trusted token issuer authentication](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/isv-info-to-provide.html) flow required by data accessor (ISV) to access cross-account Q index data via Search Relevant Content API. 

## Prerequisites

- AWS CLI (v2) installed and configured on your computer

- Two AWS Accounts (one account as ISV running this tester application, another account acting as enterprise customer running Amazon Q Business)
- [On enterprise account] Data accessor registered for your ISV and make sure to register as TTI (not Auth code)
- [On enterprise account] Amazon Q Business application setup with IAM IDC as access management on enterprise customer AWS account 
- [On ISV account] As demo purpose, this sample assume ISV is using [AWS Cognito](https://aws.amazon.com/cognito/) as [OAuth 2.0 authorization server registered with data accessor](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/isv-info-to-provide.html)
- Enable Nova Pro model access on Amazon Bedrock

## Key Components

The key component of this solution is to show the user authentication flow step-by-step (OIDC authentication with ISV's OAuth 2.0 authorization server, token generation and management, STS credential handling) required to make Amazon Q Business's [SearchRelevantContent API](https://docs.aws.amazon.com/amazonq/latest/api-reference/API_SearchRelevantContent.html) requests to cross-account Q index on customer's environment.

![User Authentication Flow](/assets/shell-tti-auth-flow.png)

This flow illustrates user authentication process in order for ISV application to make SearchRelevantContent API to access customer's Q index that this frontend solution demonstrates in steps.

## Usage Steps

### Provide required information for data accessor in the shell script
- ISV
  - **IAM_ROLE** - IAM Role ARN of the data accessor
  - **TENANT_ID** - This Tenant ID needs to be same ID that was used when registering this data accessor on enterprise account
  - **COGNITO_USER_POOL_ID** - The ID of your Cognito User Pool (e.g., "us-east-1_xxxxxx"). Found in AWS Console > Cognito > User Pools > Your Pool > User pool overview
  - **COGNITO_CLIENT_ID** - The App client ID from your Cognito User Pool. Found in AWS Console > Cognito > User Pools > Your Pool > App integration > App clients
  - **COGNITO_CLIENT_SECRET** - The client secret for your app client. Found in AWS Console > Cognito > User Pools > Your Pool > App integration > App clients > Show client secret
- Enterprise
  - **QBUSINESS_APPLICATION_ID** - QBiz application ID of the enterprise account
  - **RETRIEVER_ID** - Retrieval ID of the above QBiz application
  - **IDC_APPLICATION_ARN** - ARN provided on data accessor configuration

![Configuration](assets/shell-tti-configuration.png)

### Run the shell script
```
# ./data-accessor-tti-tester.sh
Enter your prompt (or 'exit' to quit):
```

### Enter the query prompt that you want to query against the Q index
```
# ./data-accessor-tti-tester.sh
Enter your prompt (or 'exit' to quit): find out the status of project x
```

### Authenticate against ISV's IDP (ie Cognito) as prompted and retrieves ISV ID Token

```
=== AWS Cognito Authentication ===
Enter username: xxx@amazon.com
Enter password: 
```

### The script goes through the rest of proper authentication flow and calls Search Relevant Content API to retrieve the Q index information that matched against your query

```
Calling SearchRelevantContent API...
SRC API Response (High/Very High confidence only)
=================
{
  "relevantContent": [
    {
      "content": "\nProject X Status Report - RED Overall Status: RED  Key Issues:  1. Schedule: Project is currently 3 weeks behind critical milestones............",
      "documentId": "s3://xxxxxx/Project X Status Report.docx",
      "documentTitle": "Project X Status Report.docx",
      "documentUri": "https://xxxxxx.s3.amazonaws.com/Project%20X%20Status%20Report.docx",
      "documentAttributes": [
        {
          "name": "_source_uri",
          "value": {
            "stringValue": "https://xxxxxx.s3.amazonaws.com/Project%20X%20Status%20Report.docx"
          }
        },
        {
          "name": "_data_source_id",
          "value": {
            "stringValue": "xxxxxxx"
          }
        }
      ],
      "scoreAttributes": {
        "scoreConfidence": "VERY_HIGH"
      }
    },
    ......
```

### Final section of the script calls Amazon Bedrock to summarize the Q index data with the query 

```
Summarizing results with Amazon Bedrock (model - amazon.nova-pro-v1:0)...
Calling Bedrock API...
Summary
=================
**Summary for the search query "project x":**

Project X is currently facing significant challenges as indicated by two status reports:

1. **RED Status Report** (Source [1]):
.............

**URI Links:**
- RED Status Report: https://*******.s3.amazonaws.com/Project%20X%20Status%20Report.docx
```

## Clean Up

To remove the solution from your account, please follow these steps:

1. Remove data accessor
    - Go to the AWS Management Console, navigate to Amazon Q Business >  Data accessors
    - Select your data accessor and click 'Delete'
