# Misc

## AWS CLI 

### Enable Data Accessor (Auth Code)
<details>
<summary>details</summary>

1. Initiate below 3 commands to enable data accessor under your Amazon Q Business application

ISV's data accessor principal role can be found from this page: [ISV data accessor principal role ARNs for the CreateDataAccessor API](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/data-accessors-granting-permissions-cli.html#data-accessors-granting-permissions-cli-principal-arns)

```
aws qbusiness create-data-accessor \
--application-id <your Q business application ID> \
--principal <ISV's data accessor principal role> \
--display-name <name of data accessor> \
--authentication-detail '{
  "authenticationType": "AWS_IAM_IDC_AUTH_CODE",
  "externalIds": ["<ISV's tenant ID that will be used for this account>"]
}' \
--action-configurations '[{
  "action": "qbusiness:SearchRelevantContent"
}]'
```
learn more on [create-data-accessor](https://docs.aws.amazon.com/cli/latest/reference/qbusiness/create-data-accessor.html)

```
aws qbusiness associate-permission \
--application-id <Q Business application ID \
--statement-id <unique identifier for policy statement> \
--actions qbusiness:SearchRelevantContent \
--principal <ISV's data accessor principal role>
```
learn more on [associate-permission](https://docs.aws.amazon.com/cli/latest/reference/qbusiness/associate-permission.html)

```
aws sso-admin put-application-assignment-configuration \
--application-arn <value of idcApplicationArn, returned from create-data-accessor> \
--no-assignment-required \
--region us-east-1
```
learn more on [put-application-assignment-configuration](https://docs.aws.amazon.com/cli/latest/reference/sso-admin/put-application-assignment-configuration.html)
</details>

### Enable Data Accessor (TTI Auth)
<details>
<summary>details</summary>

1. First, go to IAM Identity Center console page, and at the Settings > Authentication, click on 'Create trusted token issuer'.

```
Issuer URL - <Issuer URL of the ISV's OAuth authentication server> hint: remove /.well-known/openid-configuration from url
Trusted token issuer name - <put in any name>
Identity provider attribute - Email maps to Email
```

Once trusted token issuer is created, copy the TTI ARN for later use.

2. Initiate below 3 commands to enable data accessor under your Amazon Q Business application

ISV's data accessor principal role can be found from this page: [ISV data accessor principal role ARNs for the CreateDataAccessor API](https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/data-accessors-granting-permissions-cli.html#data-accessors-granting-permissions-cli-principal-arns)

```
aws qbusiness create-data-accessor \
--application-id <your Q business application ID> \
--principal <ISV's data accessor principal role> \
--display-name <name of data accessor> \
--authentication-detail '{
  "authenticationType": "AWS_IAM_IDC_TTI",
  "authenticationConfiguration": {
    "idcTrustedTokenIssuerConfiguration": {
      "idcTrustedTokenIssuerArn": "<TTI ARN from the above step 1>"
    }
  },
  "externalIds": ["<ISV's tenant ID that will be used for this account>"]
}' \
--action-configurations '[{
  "action": "qbusiness:SearchRelevantContent"
}]'
```
learn more on [create-data-accessor](https://docs.aws.amazon.com/cli/latest/reference/qbusiness/create-data-accessor.html)

```
aws qbusiness associate-permission \
--application-id <Q Business application ID> \
--statement-id <name of statement> \
--actions qbusiness:SearchRelevantContent \
--principal <data accessor IAM role>
```
learn more on [associate-permission](https://docs.aws.amazon.com/cli/latest/reference/qbusiness/associate-permission.html)

```
aws sso-admin put-application-assignment-configuration \
--application-arn <value of idcApplicationArn, returned from create-data-accessor> \
--no-assignment-required \
--region us-east-1
```
learn more on [put-application-assignment-configuration](https://docs.aws.amazon.com/cli/latest/reference/sso-admin/put-application-assignment-configuration.html)
</details>

### Get Data Accessor configuration information 
<details>
<summary>details</summary>

```
aws qbusiness get-data-accessor \
--application-id <Q Business application ID> \
--data-accessor-id <Data Accessor ID>
```
lear more on [get-data-accessor](https://docs.aws.amazon.com/cli/latest/reference/qbusiness/get-data-accessor.html)

</details>