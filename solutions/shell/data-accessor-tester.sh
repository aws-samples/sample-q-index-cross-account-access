#!/bin/bash

# Configuration
## ISV provided data
IAM_ROLE=""
REDIRECT_URL="https://localhost:8081"
BEDROCK_REGION="us-east-1"
BEDROCK_MODEL_ID="amazon.nova-pro-v1:0"

## Enterprise provided data
QBUSINESS_APPLICATION_ID=""
RETRIEVER_ID=""
IDC_APPLICATION_ARN=""
QBUSINESS_REGION="us-east-1"
IAM_IDC_REGION="us-east-1"

# Function to capture user query
get_user_query() {
    local user_query
    stty erase '^?'  # Set the erase character
    read -e -p "Enter your prompt (or 'exit' to quit): " user_query
    
    # Check if user wants to exit
    if [ "$user_query" = "exit" ]; then
        echo "Exiting..."
        exit 0
    fi

    # Check for empty query
    if [ -z "$user_query" ]; then
        echo "Error: Empty query not allowed"
        exit 1
    fi

    # Export the query so it's available to other functions
    export USER_QUERY="$user_query"
    echo "Query saved: $USER_QUERY"
}


# Function to generate authorization URL and get auth code
get_auth_code() {
    # Save original stdout
    exec 3>&1
    
    # Redirect stdout to stderr for prompts/messages
    exec 1>&2

    # Create state parameter with configuration
    local STATE_DATA="{\"iamIdcRegion\":\"$IAM_IDC_REGION\",\"iamRole\":\"$IAM_ROLE\",\"idcApplicationArn\":\"$IDC_APPLICATION_ARN\",\"redirectUrl\":\"$REDIRECT_URL\"}"
    
    # Encode state to base64
    local STATE=$(echo -n "$STATE_DATA" | base64)
    
    # Generate authorization URL
    local AUTH_URL="https://oidc.${IAM_IDC_REGION}.amazonaws.com/authorize?response_type=code&client_id=$(urlencode "$IDC_APPLICATION_ARN")&redirect_uri=$(urlencode "$REDIRECT_URL")&state=$(urlencode "$STATE")"
    
    # Display instructions using echo
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
    
    # Get authorization code
    echo -n "Enter the authorization code from the redirect URL: "
    read -r AUTH_CODE </dev/tty
    
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

# Function to assume first role
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
    
    # Extract temporary credentials
    export TEMP_ACCESS_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.AccessKeyId')
    export TEMP_SECRET_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SecretAccessKey')
    export TEMP_SESSION_TOKEN=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SessionToken')
}

# Function to get IDC token
get_idc_token() {
    local AUTH_CODE=$1
    echo "Getting IDC token..."

    # Save original credentials if they exist
    local ORIG_ACCESS_KEY="$AWS_ACCESS_KEY_ID"
    local ORIG_SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
    local ORIG_SESSION_TOKEN="$AWS_SESSION_TOKEN"
    
    # Set temporary credentials for token creation
    export AWS_ACCESS_KEY_ID="$TEMP_ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$TEMP_SECRET_KEY"
    export AWS_SESSION_TOKEN="$TEMP_SESSION_TOKEN"
    
    TOKEN_RESPONSE=$(aws sso-oidc create-token-with-iam \
        --client-id "$IDC_APPLICATION_ARN" \
        --code "$AUTH_CODE" \
        --grant-type "authorization_code" \
        --redirect-uri "$REDIRECT_URL" \
        --region "$IAM_IDC_REGION" \
        --output json)

    # Restore original credentials if they existed
    if [ -n "$ORIG_ACCESS_KEY" ]; then
        export AWS_ACCESS_KEY_ID="$ORIG_ACCESS_KEY"
        export AWS_SECRET_ACCESS_KEY="$ORIG_SECRET_KEY"
        export AWS_SESSION_TOKEN="$ORIG_SESSION_TOKEN"
    else
        # If no original credentials, unset the temporary ones
        unset AWS_ACCESS_KEY_ID
        unset AWS_SECRET_ACCESS_KEY
        unset AWS_SESSION_TOKEN
    fi
    
    if [ $? -ne 0 ]; then
        echo "Error getting IDC token"
        exit 1
    fi

    # Extract tokens using jq, with error checking
    if ! ID_TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.idToken' 2>/dev/null); then
        echo "Error: Failed to parse ID token" >&2
        echo "$TOKEN_RESPONSE" >&2
        exit 1
    fi

    echo "Received IDC token"
    echo "================="
    echo "${ID_TOKEN}"
    echo "================="
    echo
}

# Function to process IDC token and assume role with identity context
process_token_and_assume_role() {
    echo "Processing IDC token and assuming role with identity context..."
    
    # Extract identity context from IDC token
    TOKEN_PAYLOAD=$(echo "$ID_TOKEN" | cut -d'.' -f2 | tr -d '-' | tr '_' '/' | sed -e 's/$/\=\=/' | base64 -d 2>/dev/null)
    
    # Extract identity context with error checking
    if ! IDENTITY_CONTEXT=$(echo "$TOKEN_PAYLOAD" | jq -r '."sts:identity_context"' 2>/dev/null); then
        echo "Error: Failed to extract identity context" >&2
        exit 1
    fi


    # Validate the context
    if [ -z "$IDENTITY_CONTEXT" ] || [ ${#IDENTITY_CONTEXT} -lt 4 ]; then
        echo "Error: Invalid identity context" >&2
        exit 1
    fi
    
    # Assume role with identity context
    TEMP_CREDENTIALS=$(aws sts assume-role \
        --role-arn "$IAM_ROLE" \
        --role-session-name "automated-session" \
        --provided-contexts '[{"ProviderArn":"arn:aws:iam::aws:contextProvider/IdentityCenter","ContextAssertion":"'"$IDENTITY_CONTEXT"'"}]' \
        --tags Key=qbusiness-dataaccessor:ExternalId,Value=CLI-Test \
        --output json)
    
    # Extract temporary credentials
    TEMP_ACCESS_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.AccessKeyId')
    TEMP_SECRET_KEY=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SecretAccessKey')
    TEMP_SESSION_TOKEN=$(echo $TEMP_CREDENTIALS | jq -r '.Credentials.SessionToken')
    
    # Output temporary credentials
    echo "Temporary credentials"
    echo "================="
    echo "Access Key: $TEMP_ACCESS_KEY"
    echo "Secret Key: $TEMP_SECRET_KEY"
    echo "Session Token: $TEMP_SESSION_TOKEN"
    echo "================="
    echo

}

# Call SearchRelevantContent API with temporary credentials
call_src_api() {
    echo "Calling SearchRelevantContent API..."

    # Validate that we have credentials from assumed role
    if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ] || [ -z "$AWS_SESSION_TOKEN" ]; then
        echo "Error: Missing AWS credentials" >&2
        exit 1
    fi

    # Validate required parameters
    if [ -z "$QBUSINESS_APPLICATION_ID" ] || [ -z "$RETRIEVER_ID" ]; then
        echo "Error: Missing required parameters (QBUSINESS_APPLICATION_ID or RETRIEVER_ID)" >&2
        exit 1
    fi

    # Save original credentials if they exist
    local ORIG_ACCESS_KEY="$AWS_ACCESS_KEY_ID"
    local ORIG_SECRET_KEY="$AWS_SECRET_ACCESS_KEY"
    local ORIG_SESSION_TOKEN="$AWS_SESSION_TOKEN"
    
    # Set temporary credentials for token creation
    export AWS_ACCESS_KEY_ID="$TEMP_ACCESS_KEY"
    export AWS_SECRET_ACCESS_KEY="$TEMP_SECRET_KEY"
    export AWS_SESSION_TOKEN="$TEMP_SESSION_TOKEN"

    # Make the API call
    local RAW_RESPONSE
    RAW_RESPONSE=$(aws qbusiness search-relevant-content \
        --application-id "$QBUSINESS_APPLICATION_ID" \
        --query-text "$USER_QUERY" \
        --content-source '{"retriever": {"retrieverId": "'"$RETRIEVER_ID"'"}}' \
        --max-items 3 \
        --region "$QBUSINESS_REGION" \
        --output json)

    # Filter for High/Very High confidence using jq
    SRC_API_RESPONSE=$(echo "$RAW_RESPONSE" | jq '
        {
            relevantContent: [
                .relevantContent[] | 
                select(.scoreAttributes.scoreConfidence == "VERY_HIGH" or .scoreAttributes.scoreConfidence == "HIGH")
            ]
        }
    ')

    # Restore original credentials if they existed
    if [ -n "$ORIG_ACCESS_KEY" ]; then
        export AWS_ACCESS_KEY_ID="$ORIG_ACCESS_KEY"
        export AWS_SECRET_ACCESS_KEY="$ORIG_SECRET_KEY"
        export AWS_SESSION_TOKEN="$ORIG_SESSION_TOKEN"
    else
        # If no original credentials, unset the temporary ones
        unset AWS_ACCESS_KEY_ID
        unset AWS_SECRET_ACCESS_KEY
        unset AWS_SESSION_TOKEN
    fi

    # Check if the API call was successful
    if [ $? -ne 0 ]; then
        echo "Error calling SearchRelevantContent API: $RAW_RESPONSE" >&2
        exit 1
    fi

    # Check if we have any results after filtering
    local result_count
    result_count=$(echo "$SRC_API_RESPONSE" | jq '.relevantContent | length')
    
    if [ "$result_count" -eq 0 ]; then
        echo "Warning: No results with High or Very High confidence found" >&2
    fi

    # Output the filtered SRC API response
    echo "SRC API Response (High/Very High confidence only)"
    echo "================="
    echo "$SRC_API_RESPONSE" | jq '.'
    echo "================="
    echo
}

# Call Bedrock for summarization
summarize_with_bedrock() {
    local SRC_API_RESPONSE=$1
    echo "Summarizing results with Amazon Bedrock (model - $BEDROCK_MODEL_ID)..."

    # Validate Bedrock region
    if [ -z "$BEDROCK_REGION" ]; then
        echo "Error: BEDROCK_REGION not set" >&2
        exit 1
    fi

    # Extract content from API response
    local content_to_summarize
    content_to_summarize=$(echo "$SRC_API_RESPONSE" | jq -r '.relevantContent[] | 
        "Source [" + (([.documentUri] | index(.) + 1) | tostring) + "]:\n" + 
        "Title: " + .documentTitle + "\n" + 
        "URI: " + .documentUri + "\n\n" + 
        .content + "\n\n"')

    # Create prompt
    local prompt
    prompt="Please provide a concise summary for the search query \"$USER_QUERY\" based on the following search results:

            $content_to_summarize

            Model Instructions:
            - You should provide concise answer to simple questions when the answer is directly contained in search results,
            but when comes to yes/no question, provide some details.
            - In case the question requires multi-hop reasoning, you should find relevant information from search results
            and summarize the answer based on relevant information with logical reasoning.
            - If the search results do not contain information that can answer the question, please state that you could not
            find an exact answer to the question, and if search results are completely irrelevant, say that you could not
            find an exact answer, then summarize search results.
            - Remember to add citations to your response using markers like %[1]%, %[2]%, %[3]%, etc for the corresponding
            passage supports the response. Provide the document uri links to the source with markers at the end.
            - DO NOT USE INFORMATION THAT IS NOT IN SEARCH RESULTS!"

    # Create request body
    local request_body
    request_body=$(jq -n \
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

    # Create temporary files
    local temp_request=$(mktemp)
    local temp_response=$(mktemp)
    
    # Save request body to temp file
    echo "$request_body" > "$temp_request"

    # Make Bedrock API call
    echo "Calling Bedrock API..."
    if ! aws bedrock-runtime invoke-model \
        --model-id "$BEDROCK_MODEL_ID" \
        --content-type "application/json" \
        --accept "application/json" \
        --body "fileb://$temp_request" \
        --region "$BEDROCK_REGION" \
        "$temp_response" > /dev/null; then
        
        echo "Error calling Bedrock API" >&2
        cat "$temp_response" >&2
        rm "$temp_request" "$temp_response"
        return 1
    fi

    # Read response from file
    local BEDROCK_RESPONSE
    BEDROCK_RESPONSE=$(cat "$temp_response")

    # Clean up temp files
    rm "$temp_request" "$temp_response"

    # Extract summary
    local summary
    summary=$(echo "$BEDROCK_RESPONSE" | jq -r '.output.message.content[0].text // empty')

    if [ -z "$summary" ]; then
        echo "Error: Could not extract summary from response" >&2
        echo "Response structure:" >&2
        echo "$BEDROCK_RESPONSE" | jq '.' >&2
        return 1
    fi

    echo "Summary"
    echo "================="
    echo "$summary"
    echo "================="
    echo
}

# Validate configuration
validate_config() {
    if [ -z "$IAM_IDC_REGION" ] || [ -z "$IAM_ROLE" ] || [ -z "$IDC_APPLICATION_ARN" ] || [ -z "$REDIRECT_URL" ] || [ -z "$QBUSINESS_APPLICATION_ID" ] || [ -z "$RETRIEVER_ID" ]; then
        echo "Error: Please set all required configuration variables at the top of the script:"
        echo "IAM_IDC_REGION, IAM_ROLE, IDC_APPLICATION_ARN, REDIRECT_URL, QBUSINESS_APPLICATION_ID, RETRIEVER_ID"
        exit 1
    fi
}

# Function to check if required environment variables are set
check_credentials() {
    if [ -z "$AWS_ACCESS_KEY_ID" ] || [ -z "$AWS_SECRET_ACCESS_KEY" ]; then
        echo "Error: AWS credentials not set"
        exit 1
    fi
}

# Function to encode string to base64 URL-safe format
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

main() {
    # Validate configuration
    validate_config

    # Check credentials
    check_credentials

    # Capture user prompt
    get_user_query

    # Get Authorization Code from IAM IDC
    get_auth_code

    # Assume Role with IAM role registered as data accessor
    assume_first_role

    # Get IDC token with Authorization Code
    get_idc_token "$AUTH_CODE"

    # Process IDC token and assume role 
    process_token_and_assume_role

    # Call SearchRelevantContent API with temporary credentials
    call_src_api

    # Call Bedrock for summarization
    summarize_with_bedrock "$SRC_API_RESPONSE"

}

# Start script
main "$@"