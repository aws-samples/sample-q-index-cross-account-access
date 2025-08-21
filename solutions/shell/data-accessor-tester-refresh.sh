#!/bin/bash

# =============================================================================
# Cross-Account Amazon Q Business Index Data Retrieval Script
# =============================================================================
# 
# PURPOSE: This script demonstrates how an ISV (Independent Software Vendor) 
# can access a customer's Amazon Q Business index data across AWS accounts.
# 
# WHY THIS IS NEEDED:
# - ISVs need to access customer data without having direct access to customer AWS accounts
# - Amazon Q Business provides a "data accessor" mechanism for secure cross-account access
# - This enables ISVs to build AI applications using customer's enterprise data
# 
# AUTHENTICATION FLOW:
# 1. ISV registers as a "data accessor" with AWS
# 2. Customer grants the ISV access to their Q Business index
# 3. ISV uses OAuth + IAM roles to securely access customer data
# =============================================================================

# =============================================================================
# CONFIGURATION SECTION
# =============================================================================
# These values are provided by different parties in the ISV-Customer relationship

## ISV PROVIDED DATA
# These are configured by the ISV (your organization) when registering as a data accessor
IAM_ROLE=""  # Role ISV assumes for cross-account access
REDIRECT_URL="https://localhost:8081"                              # OAuth redirect URL (ISV controls this)
BEDROCK_REGION="us-east-1"                                         # Region where ISV wants to use Bedrock
BEDROCK_MODEL_ID="amazon.nova-pro-v1:0"                          # AI model for summarizing results

## ENTERPRISE CUSTOMER PROVIDED DATA  
# These are provided by the customer who owns the Q Business application
QBUSINESS_APPLICATION_ID=""  # Customer's Q Business app ID
RETRIEVER_ID=""             # Customer's data retriever ID
IDC_APPLICATION_ARN=""  # Customer's Identity Center app
QBUSINESS_REGION="us-east-1"                                      # Region where customer's Q Business runs
IAM_IDC_REGION="us-east-1"                                        # Region where customer's Identity Center runs

# =============================================================================
# CREDENTIAL MANAGEMENT
# =============================================================================
# WHY WE NEED THIS: OAuth tokens expire frequently (1 hour), but refresh tokens 
# last much longer (90 days). We cache credentials to avoid repeated authentication.

# File to store credentials and refresh tokens for reuse
CREDENTIALS_FILE="$HOME/.q_index_credentials.json"

# =============================================================================
# FUNCTION: save_credentials
# PURPOSE: Store AWS credentials and refresh token to disk for future reuse
# WHY: Avoids forcing users to re-authenticate every hour when tokens expire
# =============================================================================
save_credentials() {
    local access_key="$1"      # Temporary AWS access key
    local secret_key="$2"      # Temporary AWS secret key  
    local session_token="$3"   # Temporary AWS session token
    local refresh_token="$4"   # Long-lived refresh token (90 days)
    local expires_at="$5"      # When the AWS credentials expire
    
    # Create JSON structure with all credential information
    local credentials_json=$(jq -n \
        --arg access_key "$access_key" \
        --arg secret_key "$secret_key" \
        --arg session_token "$session_token" \
        --arg refresh_token "$refresh_token" \
        --arg expires_at "$expires_at" \
        '{
            aws_access_key_id: $access_key,
            aws_secret_access_key: $secret_key,
            aws_session_token: $session_token,
            refresh_token: $refresh_token,
            expires_at: ($expires_at | tonumber)
        }')
    
    # SECURITY FIX: Create file with secure permissions from the start
    # WHY: The original approach had a race condition vulnerability where the file
    # was created with default permissions (potentially 644 - readable by others)
    # and then chmod was applied afterward. This creates a window where sensitive
    # credentials could be readable by other users on the system.
    # 
    # SOLUTION: Use umask to ensure the file is created with restrictive permissions
    # (600 - owner read/write only) from the moment it's created, eliminating the
    # race condition entirely.
    (umask 077; echo "$credentials_json" > "$CREDENTIALS_FILE")
    echo "Credentials saved for future use"
}

# =============================================================================
# FUNCTION: load_and_check_credentials  
# PURPOSE: Check if we have valid stored credentials, refresh if needed
# WHY: Provides seamless user experience - no re-authentication if tokens are still valid
# =============================================================================
load_and_check_credentials() {
    # Check if credentials file exists
    if [ ! -f "$CREDENTIALS_FILE" ]; then
        return 1  # No stored credentials found
    fi
    
    # Load stored credentials and check expiration
    local credentials=$(cat "$CREDENTIALS_FILE")
    local current_time=$(date +%s)
    local expires_at=$(echo "$credentials" | jq -r '.expires_at // empty')
    local buffer_time=300  # 5 minute safety buffer before expiration
    
    # Check if credentials exist and are not expired (with buffer)
    if [ -n "$expires_at" ] && [ "$current_time" -lt $((expires_at - buffer_time)) ]; then
        # Credentials are still valid - load them into memory
        TEMP_ACCESS_KEY=$(echo "$credentials" | jq -r '.aws_access_key_id')
        TEMP_SECRET_KEY=$(echo "$credentials" | jq -r '.aws_secret_access_key')
        TEMP_SESSION_TOKEN=$(echo "$credentials" | jq -r '.aws_session_token')
        echo "Using stored valid credentials"
        return 0
    elif [ -n "$expires_at" ]; then
        # Credentials expired - try to refresh using refresh token
        local refresh_token=$(echo "$credentials" | jq -r '.refresh_token // empty')
        if [ -n "$refresh_token" ] && refresh_credentials_with_token "$refresh_token"; then
            echo "Credentials refreshed successfully"
            return 0
        else
            echo "Failed to refresh credentials, will re-authenticate"
            rm -f "$CREDENTIALS_FILE"  # Remove invalid credentials
            return 1
        fi
    fi
    
    return 1  # Invalid or missing credentials
}
# =============================================================================
# FUNCTION: refresh_credentials_with_token
# PURPOSE: Use a refresh token to get new AWS credentials without user interaction
# WHY: Refresh tokens last 90 days vs 1 hour for access tokens - much better UX
# 
# OAUTH FLOW EXPLANATION:
# 1. Original authentication gives us both access token + refresh token
# 2. Access token expires in 1 hour, refresh token lasts 90 days  
# 3. When access token expires, we use refresh token to get new access token
# 4. This avoids forcing user to go through browser authentication again
# =============================================================================
refresh_credentials_with_token() {
    local refresh_token="$1"
    echo "Refreshing credentials using stored refresh token..."
    
    # STEP 1: Use refresh token to get new ID token from AWS SSO
    # WHY: The refresh token can generate new access tokens without user interaction
    local TOKEN_RESPONSE
    TOKEN_RESPONSE=$(aws sso-oidc create-token \
        --client-id "$IDC_APPLICATION_ARN" \
        --refresh-token "$refresh_token" \
        --grant-type "refresh_token" \
        --region "$IAM_IDC_REGION" \
        --output json 2>/dev/null)
    
    # Check if refresh token request succeeded
    if [ $? -ne 0 ] || [ -z "$TOKEN_RESPONSE" ]; then
        return 1  # Refresh failed - token might be expired
    fi
    
    # STEP 2: Extract new ID token from response
    local NEW_ID_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.idToken // empty')
    if [ -z "$NEW_ID_TOKEN" ]; then
        return 1  # No ID token in response
    fi
    
    # STEP 3: Extract identity context from the new ID token
    # WHY: Identity context proves who the user is to AWS STS for role assumption
    local TOKEN_PAYLOAD=$(echo "$NEW_ID_TOKEN" | cut -d'.' -f2 | tr -d '-' | tr '_' '/' | sed -e 's/$/\=\=/' | base64 -d 2>/dev/null)
    local IDENTITY_CONTEXT=$(echo "$TOKEN_PAYLOAD" | jq -r '."sts:identity_context" // empty')
    
    if [ -z "$IDENTITY_CONTEXT" ]; then
        return 1  # Could not extract identity context
    fi
    
    # STEP 4: Assume the cross-account role using the identity context
    # WHY: This gives us temporary AWS credentials to access the customer's Q Business index
    local TEMP_CREDENTIALS=$(aws sts assume-role \
        --role-arn "$IAM_ROLE" \
        --role-session-name "refreshed-session-$(date +%s)" \
        --provided-contexts '[{"ProviderArn":"arn:aws:iam::aws:contextProvider/IdentityCenter","ContextAssertion":"'"$IDENTITY_CONTEXT"'"}]' \
        --tags Key=qbusiness-dataaccessor:ExternalId,Value=CLI-Test-Refresh \
        --output json)
    
    if [ $? -ne 0 ]; then
        return 1  # Role assumption failed
    fi
    
    # STEP 5: Extract the new temporary AWS credentials
    TEMP_ACCESS_KEY=$(echo "$TEMP_CREDENTIALS" | jq -r '.Credentials.AccessKeyId')
    TEMP_SECRET_KEY=$(echo "$TEMP_CREDENTIALS" | jq -r '.Credentials.SecretAccessKey')
    TEMP_SESSION_TOKEN=$(echo "$TEMP_CREDENTIALS" | jq -r '.Credentials.SessionToken')
    local CREDENTIAL_EXPIRATION=$(echo "$TEMP_CREDENTIALS" | jq -r '.Credentials.Expiration')
    
    # STEP 6: Convert expiration time to Unix timestamp for storage
    local EXPIRES_AT
    if command -v gdate >/dev/null 2>&1; then
        EXPIRES_AT=$(gdate -d "$CREDENTIAL_EXPIRATION" +%s)  # GNU date (Linux/macOS with gdate)
    else
        EXPIRES_AT=$(date -d "$CREDENTIAL_EXPIRATION" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${CREDENTIAL_EXPIRATION%.*}" +%s 2>/dev/null)
    fi
    
    if [ -z "$EXPIRES_AT" ]; then
        EXPIRES_AT=$(($(date +%s) + 3600))  # Fallback: assume 1 hour expiration
    fi
    
    # STEP 7: Get new refresh token (or reuse existing if not provided)
    local NEW_REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refreshToken // empty')
    if [ -z "$NEW_REFRESH_TOKEN" ]; then
        NEW_REFRESH_TOKEN="$refresh_token"  # Reuse existing refresh token
    fi
    
    # STEP 8: Save the refreshed credentials for future use
    save_credentials "$TEMP_ACCESS_KEY" "$TEMP_SECRET_KEY" "$TEMP_SESSION_TOKEN" "$NEW_REFRESH_TOKEN" "$EXPIRES_AT"
    
    return 0  # Success
}

# =============================================================================
# FUNCTION: get_user_query
# PURPOSE: Capture the user's search query with proper input handling
# WHY: We need to know what the user wants to search for in the Q Business index
# =============================================================================
get_user_query() {
    local user_query
    stty erase '^?'  # Set proper backspace handling for user input
    read -e -p "Enter your prompt (or 'exit' to quit): " user_query
    
    # Allow user to exit gracefully
    if [ "$user_query" = "exit" ]; then
        echo "Exiting..."
        exit 0
    fi

    # Validate that user provided a query
    if [ -z "$user_query" ]; then
        echo "Error: Empty query not allowed"
        exit 1
    fi

    # Make query available to other functions
    export USER_QUERY="$user_query"
    echo "Query saved: $USER_QUERY"
}
# =============================================================================
# FUNCTION: get_auth_code
# PURPOSE: Guide user through OAuth authentication to get authorization code
# WHY: OAuth is required for secure cross-account access - proves user identity
# 
# OAUTH FLOW EXPLANATION:
# 1. Generate authorization URL with customer's Identity Center application
# 2. User visits URL in browser and authenticates with their corporate credentials  
# 3. After successful auth, browser redirects to our URL with authorization code
# 4. We use this code to prove the user successfully authenticated
# =============================================================================
get_auth_code() {
    # Save original stdout for later restoration
    exec 3>&1
    
    # Redirect stdout to stderr so prompts appear correctly
    exec 1>&2

    # STEP 1: Create state parameter with configuration information
    # WHY: State parameter prevents CSRF attacks and carries config data through OAuth flow
    local STATE_DATA="{\"iamIdcRegion\":\"$IAM_IDC_REGION\",\"iamRole\":\"$IAM_ROLE\",\"idcApplicationArn\":\"$IDC_APPLICATION_ARN\",\"redirectUrl\":\"$REDIRECT_URL\"}"
    
    # Encode state to base64 for URL safety
    local STATE=$(echo -n "$STATE_DATA" | base64)
    
    # STEP 2: Generate OAuth authorization URL
    # WHY: This URL takes user to customer's Identity Center for authentication
    local AUTH_URL="https://oidc.${IAM_IDC_REGION}.amazonaws.com/authorize?response_type=code&client_id=$(urlencode "$IDC_APPLICATION_ARN")&redirect_uri=$(urlencode "$REDIRECT_URL")&state=$(urlencode "$STATE")"
    
    # STEP 3: Display instructions to user
    echo
    echo "=== AWS OIDC Authentication ==="
    echo
    echo "Please follow these steps:"
    echo "------------------------"
    echo "1. Copy and paste this URL in your browser:"
    echo
    echo "$AUTH_URL"
    echo
    echo "2. Complete the authentication process in your browser"
    echo "3. After authentication, you will be redirected to: $REDIRECT_URL"
    echo "4. From the redirect URL, copy the 'code' parameter value"
    echo
    
    # STEP 4: Get authorization code from user
    stty erase '^?'  # Enable proper backspace handling
    read -e -p "Enter the authorization code from the redirect URL: " AUTH_CODE

    # Validate that user provided the code
    if [ -z "$AUTH_CODE" ]; then
        echo "Error: Authorization code cannot be empty"
        exit 1
    fi
    
    echo
    echo "Received authorization code"
    echo "================="
    echo "$AUTH_CODE"
    echo "================="
    echo
}

# =============================================================================
# FUNCTION: assume_first_role
# PURPOSE: Assume the ISV's cross-account role to get initial AWS credentials
# WHY: We need AWS credentials to make API calls to exchange OAuth code for tokens
# 
# ROLE ASSUMPTION EXPLANATION:
# - The ISV has registered a role that can be assumed for cross-account access
# - This role has permissions to call AWS SSO APIs
# - We assume this role first to get credentials for the token exchange
# =============================================================================
assume_first_role() {
    echo "Assuming initial role..."
    
    # Assume the cross-account role that ISV registered as data accessor
    TEMP_CREDENTIALS=$(aws sts assume-role \
        --role-arn "$IAM_ROLE" \
        --role-session-name "automated-session" \
        --tags Key=qbusiness-dataaccessor:ExternalId,Value=CLI-Test \
        --output json)
    
    if [ $? -ne 0 ]; then
        echo "Error assuming initial role"
        exit 1
    fi
    
    # Extract temporary credentials for use in subsequent API calls
    export TEMP_ACCESS_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.AccessKeyId')
    export TEMP_SECRET_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SecretAccessKey')
    export TEMP_SESSION_TOKEN=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SessionToken')
}

# =============================================================================
# FUNCTION: get_idc_token
# PURPOSE: Exchange OAuth authorization code for Identity Center tokens
# WHY: The authorization code proves user authenticated - we exchange it for usable tokens
# 
# TOKEN EXCHANGE EXPLANATION:
# 1. Authorization code is single-use proof of authentication
# 2. We exchange it for ID token (contains user identity) and refresh token (for renewals)
# 3. ID token contains "identity context" needed for cross-account role assumption
# =============================================================================
get_idc_token() {
    local AUTH_CODE=$1
    echo "Getting IDC token..."

    # Save original AWS credentials to restore later
    local ORIG_ACCESS_KEY="$AWS_ACCESS_KEY_ID"
    local ORIG_SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
    local ORIG_SESSION_TOKEN="$AWS_SESSION_TOKEN"
    
    # Set temporary credentials for this API call
    export AWS_ACCESS_KEY_ID="$TEMP_ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$TEMP_SECRET_KEY"
    export AWS_SESSION_TOKEN="$TEMP_SESSION_TOKEN"
    
    # STEP 1: Exchange authorization code for tokens
    # WHY: This proves the user successfully authenticated and gives us identity tokens
    TOKEN_RESPONSE=$(aws sso-oidc create-token-with-iam \
        --client-id "$IDC_APPLICATION_ARN" \
        --code "$AUTH_CODE" \
        --grant-type "authorization_code" \
        --redirect-uri "$REDIRECT_URL" \
        --region "$IAM_IDC_REGION" \
        --output json)

    # Restore original credentials
    if [ -n "$ORIG_ACCESS_KEY" ]; then
        export AWS_ACCESS_KEY_ID="$ORIG_ACCESS_KEY"
        export AWS_SECRET_ACCESS_KEY="$ORIG_SECRET_KEY"
        export AWS_SESSION_TOKEN="$ORIG_SESSION_TOKEN"
    else
        unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
    fi
    
    if [ $? -ne 0 ]; then
        echo "Error getting IDC token"
        exit 1
    fi

    # STEP 2: Extract ID token (contains user identity information)
    if ! ID_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.idToken' 2>/dev/null); then
        echo "Error: Failed to parse ID token" >&2
        echo "$TOKEN_RESPONSE" >&2
        exit 1
    fi

    # STEP 3: Extract refresh token for automatic credential renewal
    REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refreshToken // empty')

    echo "Received IDC token"
    echo "================="
    echo "ID token received successfully"
    echo "================="
    if [ -n "$REFRESH_TOKEN" ]; then
        echo "Refresh token captured for automatic renewal"
    fi
    echo
}
# =============================================================================
# FUNCTION: get_auth_code
# PURPOSE: Guide user through OAuth authentication to get authorization code
# WHY: OAuth is required for secure cross-account access - proves user identity
# =============================================================================
get_auth_code() {
    exec 3>&1
    exec 1>&2

    # Create state parameter with configuration
    local STATE_DATA="{\"iamIdcRegion\":\"$IAM_IDC_REGION\",\"iamRole\":\"$IAM_ROLE\",\"idcApplicationArn\":\"$IDC_APPLICATION_ARN\",\"redirectUrl\":\"$REDIRECT_URL\"}"
    local STATE=$(echo -n "$STATE_DATA" | base64)
    
    # Generate OAuth authorization URL
    local AUTH_URL="https://oidc.${IAM_IDC_REGION}.amazonaws.com/authorize?response_type=code&client_id=$(urlencode "$IDC_APPLICATION_ARN")&redirect_uri=$(urlencode "$REDIRECT_URL")&state=$(urlencode "$STATE")"
    
    echo
    echo "=== AWS OIDC Authentication ==="
    echo "1. Copy and paste this URL in your browser:"
    echo "$AUTH_URL"
    echo "2. Complete authentication and copy the 'code' parameter from redirect URL"
    echo
    
    stty erase '^?'
    read -e -p "Enter the authorization code: " AUTH_CODE

    if [ -z "$AUTH_CODE" ]; then
        echo "Error: Authorization code cannot be empty"
        exit 1
    fi
    
    echo "Received authorization code"
    echo "================="
    echo "Authorization code received successfully"
    echo "================="
}

# =============================================================================
# FUNCTION: assume_first_role  
# PURPOSE: Get initial AWS credentials by assuming the ISV's registered role
# WHY: Need credentials to make AWS API calls for token exchange
# =============================================================================
assume_first_role() {
    echo "Assuming initial role..."
    TEMP_CREDENTIALS=$(aws sts assume-role \
        --role-arn "$IAM_ROLE" \
        --role-session-name "automated-session" \
        --tags Key=qbusiness-dataaccessor:ExternalId,Value=CLI-Test \
        --output json)
    
    if [ $? -ne 0 ]; then
        echo "Error assuming initial role"
        exit 1
    fi
    
    export TEMP_ACCESS_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.AccessKeyId')
    export TEMP_SECRET_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SecretAccessKey')
    export TEMP_SESSION_TOKEN=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SessionToken')
}

# =============================================================================
# FUNCTION: get_idc_token
# PURPOSE: Exchange OAuth code for Identity Center tokens
# WHY: Need ID token with identity context for cross-account role assumption
# =============================================================================
get_idc_token() {
    local AUTH_CODE=$1
    echo "Getting IDC token..."

    # Save and set credentials for API call
    local ORIG_ACCESS_KEY="$AWS_ACCESS_KEY_ID"
    local ORIG_SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
    local ORIG_SESSION_TOKEN="$AWS_SESSION_TOKEN"
    
    export AWS_ACCESS_KEY_ID="$TEMP_ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$TEMP_SECRET_KEY"
    export AWS_SESSION_TOKEN="$TEMP_SESSION_TOKEN"
    
    # Exchange authorization code for tokens
    TOKEN_RESPONSE=$(aws sso-oidc create-token-with-iam \
        --client-id "$IDC_APPLICATION_ARN" \
        --code "$AUTH_CODE" \
        --grant-type "authorization_code" \
        --redirect-uri "$REDIRECT_URL" \
        --region "$IAM_IDC_REGION" \
        --output json)

    # Restore original credentials
    if [ -n "$ORIG_ACCESS_KEY" ]; then
        export AWS_ACCESS_KEY_ID="$ORIG_ACCESS_KEY"
        export AWS_SECRET_ACCESS_KEY="$ORIG_SECRET_KEY"
        export AWS_SESSION_TOKEN="$ORIG_SESSION_TOKEN"
    else
        unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
    fi
    
    if [ $? -ne 0 ]; then
        echo "Error getting IDC token"
        exit 1
    fi

    # Extract tokens
    ID_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.idToken')
    REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.refreshToken // empty')

    echo "Received IDC token and refresh token"
}
# =============================================================================
# FUNCTION: process_token_and_assume_role
# PURPOSE: Extract identity context from ID token and assume cross-account role
# WHY: Identity context proves user identity for secure cross-account access
# =============================================================================
process_token_and_assume_role() {
    echo "Processing IDC token and assuming role with identity context..."
    
    # Extract identity context from ID token payload
    TOKEN_PAYLOAD=$(echo "$ID_TOKEN" | cut -d'.' -f2 | tr -d '-' | tr '_' '/' | sed -e 's/$/\=\=/' | base64 -d 2>/dev/null)
    IDENTITY_CONTEXT=$(echo "$TOKEN_PAYLOAD" | jq -r '."sts:identity_context"')

    if [ -z "$IDENTITY_CONTEXT" ] || [ ${#IDENTITY_CONTEXT} -lt 4 ]; then
        echo "Error: Invalid identity context"
        exit 1
    fi
    
    # Assume role with identity context for cross-account access
    TEMP_CREDENTIALS=$(aws sts assume-role \
        --role-arn "$IAM_ROLE" \
        --role-session-name "automated-session" \
        --provided-contexts '[{"ProviderArn":"arn:aws:iam::aws:contextProvider/IdentityCenter","ContextAssertion":"'"$IDENTITY_CONTEXT"'"}]' \
        --tags Key=qbusiness-dataaccessor:ExternalId,Value=CLI-Test \
        --output json)
    
    # Extract credentials and expiration
    TEMP_ACCESS_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.AccessKeyId')
    TEMP_SECRET_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SecretAccessKey')
    TEMP_SESSION_TOKEN=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SessionToken')
    CREDENTIAL_EXPIRATION=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.Expiration')
    
    # Convert expiration to epoch time
    local EXPIRES_AT
    if command -v gdate >/dev/null 2>&1; then
        EXPIRES_AT=$(gdate -d "$CREDENTIAL_EXPIRATION" +%s)
    else
        EXPIRES_AT=$(date -d "$CREDENTIAL_EXPIRATION" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${CREDENTIAL_EXPIRATION%.*}" +%s 2>/dev/null)
    fi
    
    if [ -z "$EXPIRES_AT" ]; then
        EXPIRES_AT=$(($(date +%s) + 3600))
    fi
    
    # Save credentials with refresh token
    if [ -n "$REFRESH_TOKEN" ]; then
        save_credentials "$TEMP_ACCESS_KEY" "$TEMP_SECRET_KEY" "$TEMP_SESSION_TOKEN" "$REFRESH_TOKEN" "$EXPIRES_AT"
    fi
    
    echo "Temporary credentials obtained and saved"
}

# =============================================================================
# FUNCTION: call_src_api
# PURPOSE: Call Amazon Q Business SearchRelevantContent API
# WHY: This is the main purpose - search customer's enterprise data
# =============================================================================
call_src_api() {
    echo "Calling SearchRelevantContent API..."

    # Validate credentials and parameters
    if [ -z "$TEMP_ACCESS_KEY" ] || [ -z "$TEMP_SECRET_KEY" ] || [ -z "$TEMP_SESSION_TOKEN" ]; then
        echo "Error: Missing AWS credentials"
        exit 1
    fi

    # Save and set credentials for API call
    local ORIG_ACCESS_KEY="$AWS_ACCESS_KEY_ID"
    local ORIG_SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
    local ORIG_SESSION_TOKEN="$AWS_SESSION_TOKEN"
    
    export AWS_ACCESS_KEY_ID="$TEMP_ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$TEMP_SECRET_KEY"
    export AWS_SESSION_TOKEN="$TEMP_SESSION_TOKEN"

    # Call Q Business API to search customer's data
    local RAW_RESPONSE
    RAW_RESPONSE=$(aws qbusiness search-relevant-content \
        --application-id "$QBUSINESS_APPLICATION_ID" \
        --query-text "$USER_QUERY" \
        --content-source '{"retriever": {"retrieverId": "'"$RETRIEVER_ID"'"}}' \
        --max-items 3 \
        --region "$QBUSINESS_REGION" \
        --output json)

    # Filter for high confidence results only
    SRC_API_RESPONSE=$(echo "$RAW_RESPONSE" | jq '
        {
            relevantContent: [
                .relevantContent[] | 
                select(.scoreAttributes.scoreConfidence == "VERY_HIGH" or .scoreAttributes.scoreConfidence == "HIGH")
            ]
        }
    ')

    # Restore original credentials
    if [ -n "$ORIG_ACCESS_KEY" ]; then
        export AWS_ACCESS_KEY_ID="$ORIG_ACCESS_KEY"
        export AWS_SECRET_ACCESS_KEY="$ORIG_SECRET_KEY"
        export AWS_SESSION_TOKEN="$ORIG_SESSION_TOKEN"
    else
        unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN
    fi

    if [ $? -ne 0 ]; then
        echo "Error calling SearchRelevantContent API"
        exit 1
    fi

    echo "SRC API Response (High/Very High confidence only)"
    echo "$SRC_API_RESPONSE" | jq '.'
}

# =============================================================================
# FUNCTION: summarize_with_bedrock
# PURPOSE: Use Amazon Bedrock to summarize search results
# WHY: Raw search results are hard to read - AI summary provides better UX
# =============================================================================
summarize_with_bedrock() {
    local SRC_API_RESPONSE=$1
    echo "Summarizing results with Amazon Bedrock..."

    # Extract content from search results
    local content_to_summarize
    content_to_summarize=$(echo "$SRC_API_RESPONSE" | jq -r '.relevantContent[] | 
        "Source [" + (([.documentUri] | index(.) + 1) | tostring) + "]:\n" + 
        "Title: " + .documentTitle + "\n" + 
        "URI: " + .documentUri + "\n\n" + 
        .content + "\n\n"')

    # Create AI prompt for summarization
    local prompt="Please provide a concise summary for the search query \"$USER_QUERY\" based on the following search results:

            $content_to_summarize

            Model Instructions:
            - Provide concise answers when information is directly available
            - Use logical reasoning for complex questions
            - State if information is not available in search results
            - Add citations using %[1]%, %[2]%, etc.
            - Only use information from search results"

    # Create request body for Bedrock
    local request_body=$(jq -n \
        --arg prompt "$prompt" \
        '{
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            text: $prompt
                        }
                    ]
                }
            ]
        }')

    # Create temporary files for API call
    local temp_request=$(mktemp)
    local temp_response=$(mktemp)
    
    echo "$request_body" > "$temp_request"

    # Call Bedrock API for summarization
    if ! aws bedrock-runtime invoke-model \
        --model-id "$BEDROCK_MODEL_ID" \
        --content-type "application/json" \
        --accept "application/json" \
        --body "fileb://$temp_request" \
        --region "$BEDROCK_REGION" \
        "$temp_response" > /dev/null; then
        
        echo "Error calling Bedrock API"
        rm "$temp_request" "$temp_response"
        return 1
    fi

    # Extract and display summary
    local BEDROCK_RESPONSE=$(cat "$temp_response")
    rm "$temp_request" "$temp_response"

    local summary=$(echo "$BEDROCK_RESPONSE" | jq -r '.output.message.content[0].text // empty')

    if [ -z "$summary" ]; then
        echo "Error: Could not extract summary from response"
        return 1
    fi

    echo "Summary"
    echo "================="
    echo "$summary"
    echo "================="
}

# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

validate_config() {
    if [ -z "$IAM_IDC_REGION" ] || [ -z "$IAM_ROLE" ] || [ -z "$IDC_APPLICATION_ARN" ] || [ -z "$REDIRECT_URL" ] || [ -z "$QBUSINESS_APPLICATION_ID" ] || [ -z "$RETRIEVER_ID" ]; then
        echo "Error: Please set all required configuration variables"
        exit 1
    fi
}

check_credentials() {
    if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
        echo "Using AWS credentials from environment variables"
        return 0
    elif aws sts get-caller-identity >/dev/null 2>&1; then
        echo "Using AWS credentials from AWS CLI configuration"
        return 0
    else
        echo "Error: AWS credentials not set"
        return 1
    fi
}

urlencode() {
    local LANG=C
    local string="$1"
    local length="${#string}"
    local encoded=""
    local pos c o
    
    for (( pos=0 ; pos<length ; pos++ )); do
        c="${string:$pos:1}"
        case "$c" in
            [-_.~a-zA-Z0-9] ) o="${c}" ;;
            * ) printf -v o '%%%02x' "'$c"
        esac
        encoded+="${o}"
    done
    echo "${encoded}"
}

# =============================================================================
# MAIN FUNCTION
# PURPOSE: Orchestrate the entire cross-account data access flow
# =============================================================================
main() {
    validate_config
    check_credentials
    get_user_query

    # Try to use cached credentials first (better UX)
    if load_and_check_credentials; then
        echo "Using stored or refreshed credentials - skipping authentication"
    else
        echo "No valid stored credentials - proceeding with full authentication"
        get_auth_code
        assume_first_role
        get_idc_token "$AUTH_CODE"
        process_token_and_assume_role
    fi

    # Access customer data and provide AI-powered summary
    call_src_api
    summarize_with_bedrock "$SRC_API_RESPONSE"
}

# Start the script
main "$@"
