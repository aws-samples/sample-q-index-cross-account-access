import os
from dotenv import load_dotenv
from urllib.parse import urlencode
import boto3
from pydantic import BaseModel
import base64
import json

load_dotenv(".env")

class ISVInformation(BaseModel):
    """ISV Information"""
    isv_role_arn: str
    redirect_uri: str

# Enterprise Q Index and IDC must exist in a different account to ISV
class EnterpriseQIndex(BaseModel):
    """Enterprise Q Index"""
    application_id: str
    retriever_id: str
    application_region: str
    idc_application_arn: str
    idc_region: str

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

##  -- ISV Infomation --
isvInformation = ISVInformation(
    isv_role_arn = os.environ.get('ISV_ROLE_ARN'),
    redirect_uri = os.environ.get('REDIRECT_URI')
)

##  -- Enterprise Information --
enterpriseQIndex = EnterpriseQIndex(
    application_id = os.environ.get('APPLICATION_ID'),
    retriever_id = os.environ.get('RETRIEVER_ID'),
    application_region = os.environ.get('APPLICATION_REGION'),
    idc_application_arn = os.environ.get('IDC_APPLICATION_ARN'),
    idc_region = os.environ.get('IDC_REGION')
)


def get_idp_idc_authorization_url() -> str:
    auth_params = {
        'response_type': 'code',
        'redirect_uri': isvInformation.redirect_uri,
        'state': f'{enterpriseQIndex.idc_application_arn}+{enterpriseQIndex.idc_region}&',
        'client_id': enterpriseQIndex.idc_application_arn
    }

    return f'https://oidc.{enterpriseQIndex.idc_region}.amazonaws.com/authorize?{urlencode(auth_params)}'


def get_sts_credentials(authCode: str) -> any:
    """Obtain STS credentials for cross account calls to enterprises Q Index"""
    

    sts =  isvSession.client('sts')

    assume_role_response = sts.assume_role(
        RoleArn=isvInformation.isv_role_arn,
        RoleSessionName='automated-session'
    )


    # Create token session with assumed credentials
    session = boto3.Session(
        aws_access_key_id=assume_role_response['Credentials']['AccessKeyId'],
        aws_secret_access_key=assume_role_response['Credentials']['SecretAccessKey'],
        aws_session_token=assume_role_response['Credentials']['SessionToken']
    )

    # Create SSO OIDC client

    sso_oidc = session.client('sso-oidc', region_name=enterpriseQIndex.idc_region)
    
    # Get token
    token_response = sso_oidc.create_token_with_iam(
        clientId=enterpriseQIndex.idc_application_arn,
        code=authCode,
        grantType='authorization_code',
        redirectUri=isvInformation.redirect_uri
    )   

    # Extract and decode token
    payload = token_response['idToken'].split('.')[1]
    padding = '=' * (4 - len(payload) % 4)
    identity_context = json.loads(base64.b64decode(payload + padding))
    
    # Get STS identity context
    sts_context = identity_context.get('sts:identity_context')
    
    #print(sts_context)
    
    provided_contexts = [{
        'ProviderArn': 'arn:aws:iam::aws:contextProvider/IdentityCenter',
        'ContextAssertion': sts_context
    }]


    assume_role_response = sts.assume_role(
        RoleArn=isvInformation.isv_role_arn,
        RoleSessionName='automated-session',
        ProvidedContexts=provided_contexts,
        Tags=[{'Key': 'qbusiness-dataaccessor:ExternalId', 'Value': '1234567890'}]
    )

    stsCredentials = STSCredentials(
        aws_access_key_id = str(assume_role_response['Credentials']['AccessKeyId']),
        aws_secret_access_key = str(assume_role_response['Credentials']['SecretAccessKey']),
        aws_session_token= str(assume_role_response['Credentials']['SessionToken'])
    )


    return stsCredentials


def getEnterpriseQIndex() -> EnterpriseQIndex:
    """Get Enterprise Q Index Information"""
    return enterpriseQIndex

