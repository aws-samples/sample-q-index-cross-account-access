# Shell script

This shell script by using AWS CLI goes through neccessary authorization code authentication flow required by data accessor (ISV) to access cross-account Q index data via Search Relevant Content API. 

## Prerequisites

- Node (v18) and NPM (v8.19) installed and configured on your computer
- AWS CLI (v2) installed and configured on your computer

- Two AWS Accounts (one account as ISV running this tester application, another account acting as enterprise customer running Amazon Q Business)
- Data accessor registered for your ISV and make sure to add https://localhost:8081 as one of the redirect URLs ([see details from this related blogpost - Enhance enterprise productivity for your LLM solution by becoming an Amazon Q Business data accessor](https://aws.amazon.com/blogs/machine-learning/enhance-enterprise-productivity-for-your-llm-solution-by-becoming-an-amazon-q-business-data-accessor/))
- IAM Identity Center (IDC) instance setup with user added on enterprise customer AWS account
- Amazon Q Business application setup with IAM IDC as access management on enterprise customer AWS account 

## Key Components

The key component of this solution is to show the user authentication flow step-by-step (OIDC authentication with AWS IAM Identity Center, token generation and management, STS credential handling) required to make Amazon Q Business's [SearchRelevantContent API](https://docs.aws.amazon.com/amazonq/latest/api-reference/API_SearchRelevantContent.html) requests to cross-account Q index on customer's environment.

![User Authentication Flow](assets/shell-authentication-flow.png)

This flow illustrates user authentication process in order for ISV application to make SearchRelevantContent API to access customer's Q index that this frontend solution demonstrates in steps.

## Usage Steps

### Provide required information for data accessor in the shell script
- ISV
IAM_ROLE - IAM Role ARN of the data accessor
REDIRECT_URL - Callback URL that will provide authentication code
- Enterprise
QBUSINESS_APPLICATION_ID - QBiz application ID of the enterprise account
RETRIEVER_ID - Retrieval ID of the above QBiz application
IDC_APPLICATION_ARN - ARN provided on data accessor configuration

![Configuration](assets/shell-configuration.png)

### Run the shell script
```
# ./data-accessor-tester.sh                                                                                           [/
Enter your prompt (or 'exit' to quit):
```

### Enter the query prompt that you want to query against the Q index
```
# ./data-accessor-tester.sh
Enter your prompt (or 'exit' to quit): find out the status of project x
```

### Authenticate against IAM IDC + IDP from your browser as prompted and provide the authorization code


```
=== AWS OIDC Authentication ===

Please follow these steps:
------------------------
1. Copy and paste this URL in your browser:

https://oidc.us-east-1.amazonaws.com/authorize?response_type=code&client_id=******&redirect_uri=******&state=******

2. Complete the authentication process in your browser
3. After authentication, you will be redirected to: <your redirect url>
4. From the redirect URL, copy the 'code' parameter value

Enter the authorization code from the redirect URL:
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
