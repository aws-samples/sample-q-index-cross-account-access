from dotenv import load_dotenv
import os
import boto3
import base64
import hmac
import hashlib
import json
import base64
from pydantic import BaseModel


load_dotenv(".env")

class STSCredentials(BaseModel):
    """Temporary STS Credentials for cross account calls to enterprises Q Index"""
    aws_access_key_id: str
    aws_secret_access_key: str
    aws_session_token: str

## -- load access key and secret key for ISV account.
isvSession = boto3.Session(
    aws_access_key_id=os.environ.get('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.environ.get('AWS_SECRET_ACCESS_KEY'),
    region_name=os.environ.get('IDC_REGION')
)

def getOIDCToken(userName: str, password: str) -> any:
    print("Getting OIDC token")

    
    pool_id=os.environ.get('ISV_COGNITO_USER_POOL_ID')
    app_client_id=os.environ.get('ISV_COGNITO_CLIENT_ID')
    app_client_secret=os.environ.get('ISV_COGNITO_CLIENT_SECRET')
    
    # call cognito with user name and password to retrieve OIDC token
    oidcToken = get_isv_token(pool_id, app_client_id, app_client_secret, userName, password)


    sts =  isvSession.client('sts')

    assume_role_response = sts.assume_role(
        RoleArn=os.environ.get('ISV_ROLE_ARN'),
        RoleSessionName='automated-session',
        Tags=[{'Key': 'qbusiness-dataaccessor:ExternalId', 'Value': os.environ.get('ISV_TENANT_ID')}]
    )


    # Create token session with assumed credentials
    session = boto3.Session(
        aws_access_key_id=assume_role_response['Credentials']['AccessKeyId'],
        aws_secret_access_key=assume_role_response['Credentials']['SecretAccessKey'],
        aws_session_token=assume_role_response['Credentials']['SessionToken']
    )

    # Create SSO OIDC client
    sso_oidc = session.client('sso-oidc', region_name=os.environ.get('IDC_REGION'))

    # Get token
    token_response = sso_oidc.create_token_with_iam(
        clientId=os.environ.get('IDC_APPLICATION_ARN'),
        grantType='urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion=oidcToken
    )
    print("Received IDC token")
    
    
    payload = token_response['idToken'].split('.')[1]
    padding = '=' * (4 - len(payload) % 4)
    identity_context = json.loads(base64.b64decode(payload + padding))
    
    # Get STS identity context
    sts_context = identity_context.get('sts:identity_context')
    provided_contexts = [{
        'ProviderArn': 'arn:aws:iam::aws:contextProvider/IdentityCenter',
        'ContextAssertion': sts_context
    }]                                    

    assume_role_response = sts.assume_role(
        RoleArn=os.environ.get('ISV_ROLE_ARN'),
        RoleSessionName='automated-session',
        ProvidedContexts=provided_contexts,
        Tags=[{'Key': 'qbusiness-dataaccessor:ExternalId', 'Value': os.environ.get('ISV_TENANT_ID')}]       
    )    



    stsCredentials = STSCredentials(
        aws_access_key_id = str(assume_role_response['Credentials']['AccessKeyId']),
        aws_secret_access_key = str(assume_role_response['Credentials']['SecretAccessKey']),
        aws_session_token=assume_role_response['Credentials']['SessionToken']
    )

    #print(f"Received STS credentials = {stsCredentials}")

    return stsCredentials



def get_isv_token(cognito_user_pool_id: str, cognito_client_id: str, cognito_client_secret: str, userName: str, password: str):
    """
    Authenticate against AWS Cognito and retrieve an ID token.
    
    Args:
        cognito_user_pool_id (str): The Cognito user pool ID
        cognito_client_id (str): The Cognito client ID
        cognito_client_secret (str): The Cognito client secret
    
    Returns:
        str: The ID token from Cognito authentication
    """
    # Prompt for username and password
    print("\n=== AWS Cognito Authentication ===")


    cognito_username = userName
    cognito_password = password

    # Calculate SECRET_HASH
    message = cognito_username + cognito_client_id
    key = cognito_client_secret.encode('utf-8')
    msg = message.encode('utf-8')
    secret_hash = base64.b64encode(
        hmac.new(key, msg, digestmod=hashlib.sha256).digest()
    ).decode('utf-8')
    


    client = boto3.client('cognito-idp', region_name=os.environ.get('ISV_COGNITO_REGION'))

    # Authenticate against Cognito using ADMIN_USER_PASSWORD_AUTH flow
    try:
        response = client.admin_initiate_auth(
            UserPoolId=cognito_user_pool_id,
            ClientId=cognito_client_id,
            AuthFlow='ADMIN_USER_PASSWORD_AUTH',
            AuthParameters={
                'USERNAME': cognito_username,
                'PASSWORD': cognito_password,
                'SECRET_HASH': secret_hash
            }
        )
        


        # Extract the ID token
        isv_token = response['AuthenticationResult']['IdToken']
        
        print("\nReceived ISV token")
        print("=================")
        print(isv_token)
        print("=================")
        print()
        
        return isv_token
    
    except Exception as e:
        print(f"\nError authenticating with Cognito: {str(e)}")
        raise