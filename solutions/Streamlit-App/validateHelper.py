import boto3
import requests




def validate_AccessKey_Credentials(access_key: str, secret_key:str) -> bool:
    
    try:
        
        session = boto3.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key
        )
        sts = session.client('sts')
        response = sts.get_caller_identity()
        
        return True

    except Exception as e:
        print(e)
        return False


def validate_role_arn(access_key: str, secret_key:str, role_arn: str) -> tuple[bool, dict]:
    try:
        # Extract role name from ARN
        role_name = role_arn.split('/')[-1]
        
        session = boto3.Session(
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key
        )
        
        iam = session.client('iam')
        
        # Get role information
        role_response = iam.get_role(RoleName=role_name)
        
        # Get role policies
        attached_policies = iam.list_attached_role_policies(RoleName=role_name)
        inline_policies = iam.list_role_policies(RoleName=role_name)
        
        validation_results = {
            "exists": True,
            "arn": role_response['Role']['Arn'],
            "creation_date": role_response['Role']['CreateDate'].strftime("%Y-%m-%d"),
            "attached_policies": [p['PolicyName'] for p in attached_policies['AttachedPolicies']],
            "inline_policies": inline_policies['PolicyNames'],
            "assume_role_policy": role_response['Role']['AssumeRolePolicyDocument']
        }
        
        return True, validation_results
        
    except session.client('iam').exceptions.NoSuchEntityException:
        return False, {"error": f"Role '{role_name}' does not exist"}
    except Exception as e:
        return False, {"error": f"Error validating role: {str(e)}"}
    

def ping_url(url: str, timeout: int = 5) -> tuple[bool, str]:
    try:
        response = requests.get(url, timeout=timeout)
        return response.ok, f"Status code: {response.status_code}"
    except requests.RequestException as e:
        return False, str(e)
    