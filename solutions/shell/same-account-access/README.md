# Shell script

This shell script by using AWS CLI goes through neccessary authorization code authentication flow required by data accessor (ISV) to access cross-account Q index data via Search Relevant Content API. 

## Prerequisites

- AWS CLI (v2) installed and configured on your computer

- Single AWS Accounts (One account running Amazon Q Business)
- Amazon Q Business application setup with IAM IDC as access management on AWS account 
- This sample uses Okta IdP instance with IAM Identity Center instance, but the sample principles and steps apply to any other OIDC-compliant external identity provider synced with IAM Identity Center.
- Enable Nova Pro model access on Amazon Bedrock

## Key Components

The key component of this solution is to show the user authentication flow step-by-step (OIDC authentication, token generation and management, STS credential handling) required to make Amazon Q Business's [SearchRelevantContent API](https://docs.aws.amazon.com/amazonq/latest/api-reference/API_SearchRelevantContent.html) requests to the same account's Q index. This is temporary solution for ISV's to be able to test accessing Q index of their own environment while waiting for the [data accessor registration process](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/isv-info-to-provide.html) to complete.


## Usage Steps

### IAM Rule and Policy

1. Go to AWS Management Console, go to **Identity and Access Management(IAM)**
2. In the left navigation pane, choose **Policies** and click **Create Policy**
3. Select **JSON**, and copy the below policy and replace **region**, **source_account**, **application_id** with your values.
```
{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "sso-oauth:CreateTokenWithIAM",
        "Resource": "*",
        "Condition": {
            "StringEquals": {
                "aws:ResourceAccount": "{{source_account}}"
            }
        }
      },
      {
        "Sid": "QBusinessConversationPermission",
        "Effect": "Allow",
        "Action": [
            "qbusiness:SearchRelevantContent"
        ],
        "Resource": "arn:aws:qbusiness:{{region}}:{{source_account}}:application/{{application_id}}"
      }
    ]
}
```
4. Insert **Policy name** and select **Create policy**
5. In the left navigation pane, choose **Roles** and click **Create role**
6. Select **Custom trust policy**
7. Copy the below trust policy and select **next**
```
{
	"Version": "2012-10-17",
	"Statement": [
		{
			"Sid": "QCLITrustPolicy",
			"Effect": "Allow",
			"Principal": {
				"AWS": "arn:aws:iam::643286473409:root",
				"Service": [
            "qbusiness.amazonaws.com",
            "sso.amazonaws.com"
        ]
			},
			"Action": [
				"sts:AssumeRole",
				"sts:SetContext",
				"sts:TagSession"
			]
		}
	]
}
```
8. Select **Next**
9. For **Add permisions**, selec the policy you just created and click **Next**
10. Insert **Role name**, then click **Create role**
11. Once IAM role is created, click on the role and copy **ARN** of the IAM role. You will use this IAM role ARN when running the shell script.

### Setup Okta

1. Sign into Okta and go to the admin console.
2. In the left navigation pane, choose **Applications**, and then choose **Create App Integration**.
3. On the **Create a new app integration**** page, do the following:
  - Choose **OIDC – OpenID Connect**.
  - Choose **Web application**.
  - Then, choose **Next**.
4. On the **New Web App Integration** page, do the following:
  - In **General Settings**, for **App name**, enter a name for the application.
  - In **Grant type**, for **Core grants**, ensure that **Authorization Code** is selected. Expand **Advanced** and select on **Implicit (hybrid)** and **Allow Access Token with implicit grant type**.
  - In **Sign-in-redirect URIs**, add a URL that Okta will send the authentication response and ID token for the user's sign in request (example https://localhost:8081).
  - In **Assignements** > **Controlled access**, select **Allow everyone ins your organization to access**
  - Then, select **Save**.
5. From the application summary page, from General, do the following:
  - From **Client Credentials**, copy and save the **Client ID**. You will input this as the **Audience** when you create an identity provider in AWS Identity and Access Management in the next step.
6. From the left navigation menu, select **Security**, and then select **API**.
7. Then, from **Authorization Servers**,select the **default**, do the following:
  - Paste the **Client ID** from previous step into **Audience** value.
  - Copy the **Issuer URI**, for example https://trial-okta-instance-id.okta.com/oauth2/default, and **Audience**. You will need to input this value as the **Provider URL** when you add your identity provider in IAM in Step 2.
  - Choose **Claims** tab and choose **Add Claim**
  - For name, enter **email** and for value enter **user.email**
  - Choose **Create**
  - Choose **Access Policies** tab and choose **Add New Access Policy**
  - Insert **Name** and **Description** and keep Assign to **All cients**, then choose **Create Policy**
  - Choose **Add rule** and insert **rule name**
  - Select **Advanced**, and enable **Implicit (hybrid)**, then choose **Create rule**


### Setup Trusted Token Issuer

1. Sign into AWS Management Console, and go to **IAM Identity Center**
2. In the left navigation pane, choose Application assignements > Applications
3. Choose **Add application**
  - Select **I have an application I want to set up**
  - Application type as **OAuth 2.0**
  - Choose **Next**
  - In **Display name**, enter the name of this application
  - Select **Do not require assignements**
  - In **Application visiblity in AWS access portal**, select **Not visible**
  - Choose **Next**
4. Create **trusted token issuer**
  - In **Authentication with trusted token issuer**, select **Create trusted token issuer**
  - In **Issuer URL**, enter the Issuer URI retrieved from Okta
  - In **Trusted token issuer name**, enter the name of your application
  - Choose **Create trusted token issuer**
5. Continue creating **application**
  - Go back to the previous window and click **refresh** to see the issuer just created
  - Select the **issuer** and in **Aud claim** enter the value retrieved from Okta
  - Choose **Next**
  - Select **Edit the application policy**
  - Enter the following policy:
    ```
    {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Effect": "Allow",
          "Principal": {
            "Service": "qbusiness.amazonaws.com",
            "AWS": "<your-aws-account-id>"
          },
          "Action": [
            "sso-oauth:CreateTokenWithIAM"
          ]
        }
      ]
    }
    ```
  - Choose **Next**
  - Choose **Submit**
  - Once applicaiton is created, go to **Trusted applications for identity propagation** section and click on **Specify trusted applications**
  - Select **Specify trusted applications** and choose **Next**
  - Under **Services**, select **Amazon Q** and choose **Next**
  - Click on your Q Business application from the list and choose **Next**
  - Choose **qbusiness:content:access** and choose **Next**
  - Choose **Trust applications** 



### Provide required information for data accessor in the shell script
- **ISSUER_URL** : Issuer URL of the IDP
- **IDP_CLIENT_ID** : Client ID of the IDP
- **REDIRECT_URL** : Callback URL that will provide authentication code
- **IAM_ROLE** : IAM Role ARN of the data accessor
- **QBUSINESS_APPLICATION_ID** : QBiz application ID of the enterprise account
- **RETRIEVER_ID** : Retrieval ID of the above QBiz application
- **IDC_APPLICATION_ARN** : ARN provided on data accessor configuration

![Configuration](/assets/shell-configuration-sameaccount.png)

### Run the shell script
```
# ./src-api-tester.sh                                                                                           [/
Enter your prompt (or 'exit' to quit):
```

### Enter the query prompt that you want to query against the Q index
```
# ./src-api-tester.sh   
Enter your prompt (or 'exit' to quit): find out the status of project x
```

### Authenticate against IDP from your browser as prompted and provide the access token


```
=== OIDC Authentication ===

Please follow these steps:
------------------------
1. Copy and paste this URL in your browser:

https://*****.okta.com/oauth2/*****/v1/authorize?client_id=***&redirect_uri=https://localhost:8081&response_type=token&scope=openid email profile&state=***&nonce=***

2. Complete the authentication process in your browser
3. After authentication, you will be redirected to: <your redirect url>
4. From the redirect URL, copy the 'access_token' parameter value

Enter the access token from the redirect URL:
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

1. Remove custom application on IAM Identity Center
    - Go to the AWS Management Console, navigate to IAM Identity Center >  Applications > Customer managed
    - Select application and click 'Remove'
