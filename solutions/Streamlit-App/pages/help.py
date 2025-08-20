import streamlit as st


help = """
## Welcome to the help page
### This is a demonstration of cross acount calls as a data accessor to the Q Index Search relevant content API.
### It shows both Auth flow and TTI authentication that ISV's can implement.
[SRC Boto3 documentation](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/qbusiness/client/search_relevant_content.html)

It is assumed that you have two AWS accounts. One account contains Q Business instance that has been created in IAM IDC mode.
The second AWS account is where you will execute this application from. This application uses IAM credentials from that second AWS account to
ultimately access across account to the Q Index, with fetched temprorary credentials.
The Q Business instance needs to have a Index with data and this account is allow listed with your data retriever that you are looking to test.
it is recommended that the data accessor that is allow listed in your test account has
been configured during registration so that one of its redirects is pointing to https://localhost:8081, 
which is the port that this streamlit application runs on. This will allow you to run this application and walk through 
the **Auth flow** and execute the orchestration of fetching the temproray credentials with local code and connecting cross account with Q Index.

While it is recommended for testing the Auth flow with this application using localhost:8081 as the redirect. If your redirect is back to an endpoint
that is not running yet. You can copy the entire URL from the browser which will contain the Auth code and paste this into the application by
clicking on the alternative button.


In addition of being able to use the **Auth Flow**, this application can also utilize the **TTI** pattern for authentication. This application is configured to
work with a Cognito user pool that is our IDP / ODIC server. To test TTI, you will need to create a Cognito user pool, create user(s), matching email with user email 
found in IAM IDC.

The dashboard page has a short set of tests that verify your Sig V4 connection to the ISV AWS account, it can verify that the appropriate role is specified with the
correct permissions. Navigate to Dashboard and click on Run Tests.

Before you can use this applcation, verify that all the correct information has been entered into the local .env file.
```
# ISV API Access Keys
AWS_ACCESS_KEY_ID={Your Access Key ID for your ISV account}
AWS_SECRET_ACCESS_KEY={Your secret key from your ISV account}


# ISV Q Index Role
ISV_ROLE_ARN={Role created in your ISV account}
REDIRECT_URI={https://localhost:8081 This the redirect back with the Auth code. Leave this property blank if using TTI}


# Enterprise Q index and IAM IDC details
APPLICATION_ID={Your Q Business Application ID, found on Q Business console}
RETRIEVER_ID={Your Q Business Applciation retriever ID. Found under data sources}
APPLICATION_REGION={Region where your Q Business Index exists, example us-east-1}
IDC_APPLICATION_ARN={IDC Application ARN, this can be found on Q Business console, select your data accessor for info}
IDC_REGION={Region where IAM IDC is running}


# ISV Q Index TTI Information - Using Cognito as IDP OIDC 
# This information needs to be populated if TTI is being used.
ISV_TENANT_ID={This is the external ID that was entered on the data accessor console page}
ISV_COGNITO_USER_POOL_ID={Your Cognito User Pool ID found in your ISV account}
ISV_COGNITO_CLIENT_ID={Your Cognito Client ID}
ISV_COGNITO_CLIENT_SECRET={Your Cognito Client secret}
ISV_COGNITO_REGION={Region of your Cognito instance}
```

See [Role created in your ISV account](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/isv-info-to-provide.html)

Finally because this is a demonstration of a RAG implementation, you will need access to bedrock and a model within.



To execute the application, use ```streamlit run index.py``` from application root folder. 
Navigate to the Index page and follow your authentication method that you setup for your data accessor.

For a list of dependencies check the requirements.txt file.
"""


st.markdown(help)
