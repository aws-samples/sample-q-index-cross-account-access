import os
import streamlit as st
import pandas as pd
from validateHelper import validate_AccessKey_Credentials, validate_role_arn, ping_url



# Define custom CSS
st.markdown("""
    <style>
        .custom-table td:nth-child(1) {
            # width: 300px;  # Adjust this value as needed
        }
        .custom-table {
            margin-left: 0 !important;
            margin-right: auto !important;
        }
                    
    </style>
""", unsafe_allow_html=True)

if len(os.environ.get('REDIRECT_URI')) != 0: # Auth Flow
    # keysISV = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "ISV_ROLE_ARN", "REDIRECT_URI"]
    keysISV = ["ISV_ROLE_ARN", "REDIRECT_URI"]
else: # TTI 
    # keysISV = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "ISV_ROLE_ARN", "ISV_TENANT_ID", "ISV_COGNITO_USER_POOL_ID", "ISV_COGNITO_CLIENT_ID", "ISV_COGNITO_CLIENT_SECRET", "ISV_COGNITO_REGION"]
    keysISV = ["ISV_ROLE_ARN", "ISV_TENANT_ID", "ISV_COGNITO_USER_POOL_ID", "ISV_COGNITO_CLIENT_ID", "ISV_COGNITO_CLIENT_SECRET", "ISV_COGNITO_REGION"]

keysEnterprise = [
    "APPLICATION_ID", "RETRIEVER_ID", "APPLICATION_REGION", "IDC_APPLICATION_ARN", "IDC_REGION"
]



dfISV = pd.DataFrame({
    "Key": keysISV,
    "Value": [os.environ.get(key) for key in keysISV]
})

dfEnterprise = pd.DataFrame({
    "Key": keysEnterprise,
    "Value": [os.environ.get(key) for key in keysEnterprise]
})


st.title("Dashboard")
st.markdown("### ISV Configuration") 
# Convert DataFrame to HTML with custom class
htmlISVDetails = dfISV.to_html(classes='custom-table', escape=False, index=False, header=False)
st.markdown(htmlISVDetails, unsafe_allow_html=True)    

st.markdown("### Enterprise Configuration") 
htmlEnterpriseDetails = dfEnterprise.to_html(classes='custom-table', escape=False, index=False, header=False)
st.markdown(htmlEnterpriseDetails, unsafe_allow_html=True)


if st.button("Run Tests", type="primary"):
    try:
        if validate_AccessKey_Credentials(os.environ.get("AWS_ACCESS_KEY_ID"), os.environ.get("AWS_SECRET_ACCESS_KEY")):
            st.success("ISV AWS credentials are valid")
            # validate role information
            is_valid, results = validate_role_arn(os.environ.get("AWS_ACCESS_KEY_ID"), os.environ.get("AWS_SECRET_ACCESS_KEY"), os.environ.get("ISV_ROLE_ARN"))
            if is_valid:
                st.success("ISV Role ARN exists")
                required_actions = ["sts:AssumeRole", "sts:SetContext", "sts:TagSession"]
                if not all(action in results["assume_role_policy"]["Statement"][0]["Action"] for action in required_actions):
                    st.error("ISV Role does not have all required actions:- sts:AssumeRole, sts:SetContext, sts:TagSession")
                else:
                    st.success("ISV Role has all required actions:- sts:AssumeRole, sts:SetContext, sts:TagSession")

                if isinstance(results, dict):
                    # Create a list of key-value pairs for basic info
                    basic_info = [
                        ["ARN", results["arn"]],
                        ["Creation Date", results["creation_date"]],
                        ["Attached Policies", ", ".join(results["attached_policies"]) or "None"],
                        ["Inline Policies", ", ".join(results["inline_policies"]) or "None"]
                    ]
                    
                    st.markdown("### Role Details")
                    df = pd.DataFrame(basic_info, columns=["Property", "Value"])
                    st.table(df)
                    
                    # Display assume role policy separately
                    st.markdown("### Assume Role Policy")
                    st.json(results["assume_role_policy"])

                else:
                    st.error(results["error"])                
            else:
                st.error("ISV Role ARN is invalid")        
        else:
            st.error("ISV AWS credentials are invalid")                                    

        if len(os.environ.get('REDIRECT_URI')) != 0:
            st.markdown("### Redirect URL for Auth Code")
            # ping redirect URL
            is_up, message = ping_url(os.environ.get("REDIRECT_URI"))
            if is_up:
                st.success("REDIRECT_URI is responding to ping")
            else:
                st.error(f"REDIRECT_URI is not responding to ping: {message}")


    
    except Exception as e:
        st.error(f"Error running tests: {str(e)}")





