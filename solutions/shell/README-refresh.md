# Enhanced Shell Script with Refresh Token Support

## Overview

`data-accessor-tester-refresh.sh` is an enhanced version of the original `data-accessor-tester.sh` that includes automatic refresh token functionality. This eliminates the need for users to re-authenticate when access tokens expire.

## Key Enhancements

### 1. **Automatic Token Refresh**
- Stores refresh tokens securely in `~/.q_index_credentials.json`
- Automatically refreshes expired credentials without user intervention
- Falls back to full authentication only when refresh fails

### 2. **Credential Persistence**
- Saves AWS temporary credentials with expiration timestamps
- Credentials survive script restarts and system reboots
- Secure file permissions (600) for credential storage

### 3. **Smart Authentication Flow**
- Checks for valid stored credentials on startup
- Only prompts for authentication when necessary
- Seamless user experience with minimal interruptions

## Usage

### First Run (Full Authentication)
```bash
./data-accessor-tester-refresh.sh
```

On first run, the script will:
1. Prompt for your search query
2. Guide you through browser authentication
3. Store credentials and refresh token for future use

### Subsequent Runs (Automatic)
```bash
./data-accessor-tester-refresh.sh
```

On subsequent runs, the script will:
1. Prompt for your search query
2. Automatically use stored credentials (if valid)
3. Auto-refresh credentials (if expired but refresh token valid)
4. Only re-authenticate if refresh fails

## Key Features

### Minimal Code Changes
- Built on top of the original script with minimal modifications
- Maintains all original functionality
- Easy to understand and maintain

### Robust Error Handling
- Graceful fallback to full authentication when refresh fails
- Clear status messages for user awareness
- Automatic cleanup of invalid credentials

### Security Features
- Secure credential storage with restricted file permissions
- Automatic expiration checking with 5-minute buffer
- Clean separation of stored vs. temporary credentials

## File Structure

```
~/.q_index_credentials.json  # Stored credentials (created automatically)
```

The credentials file contains:
```json
{
  "aws_access_key_id": "ASIA...",
  "aws_secret_access_key": "...",
  "aws_session_token": "...",
  "refresh_token": "...",
  "expires_at": 1234567890
}
```

## Benefits

1. **Improved User Experience**: No repeated authentication prompts
2. **Increased Productivity**: Faster subsequent queries
3. **Seamless Operation**: Works transparently in the background
4. **Secure**: Proper credential management and storage
5. **Reliable**: Automatic fallback when refresh fails

## Comparison with Original Script

| Feature | Original Script | Enhanced Script |
|---------|----------------|-----------------|
| Authentication | Every run | Only when needed |
| User Interaction | Always required | Minimal |
| Credential Storage | None | Persistent |
| Token Refresh | Not supported | Automatic |
| Fallback Handling | N/A | Robust |

---

# Testing Guide for Refresh Token Implementation

## Testing Strategy

### Phase 1: Automated Tests

#### 1. Dependencies Check
Verify all required tools are installed:
```bash
# Check for required dependencies
which jq aws base64 date
```

#### 2. AWS Configuration Test
```bash
# Verify AWS credentials are configured
aws sts get-caller-identity
```

### Phase 2: Manual Functional Tests

#### Test 1: First Run (Initial Authentication)
```bash
# Clean slate - remove any existing credentials
rm -f ~/.q_index_credentials.json

# Run the script for the first time
./data-accessor-tester-refresh.sh
```

**Expected Behavior:**
- ✅ Prompts for query input
- ✅ Shows "No valid stored credentials - proceeding with full authentication"
- ✅ Guides through browser authentication
- ✅ Shows "Refresh token captured for automatic renewal"
- ✅ Shows "Credentials saved for future use"
- ✅ Creates `~/.q_index_credentials.json` with 600 permissions
- ✅ Completes search and summarization

**Validation:**
```bash
# Check if credentials were saved
ls -la ~/.q_index_credentials.json
cat ~/.q_index_credentials.json | jq '.'
```

#### Test 2: Second Run (Using Stored Credentials)
```bash
# Run immediately after first run
./data-accessor-tester-refresh.sh
```

**Expected Behavior:**
- ✅ Prompts for query input
- ✅ Shows "Using stored or refreshed credentials - skipping authentication"
- ✅ No browser authentication required
- ✅ Directly proceeds to search
- ✅ Completes successfully

#### Test 3: Credential Expiration Simulation
```bash
# Manually expire credentials by setting past expiration time
cp ~/.q_index_credentials.json ~/.q_index_credentials.json.backup
jq '.expires_at = 1000000000' ~/.q_index_credentials.json > temp.json && mv temp.json ~/.q_index_credentials.json

# Now run the script
./data-accessor-tester-refresh.sh

# Restore backup if needed
mv ~/.q_index_credentials.json.backup ~/.q_index_credentials.json
```

**Expected Behavior:**
- ✅ Detects expired credentials
- ✅ Shows "Refreshing credentials using stored refresh token..."
- ✅ Shows "Credentials refreshed successfully"
- ✅ Updates credentials file with new expiration
- ✅ Completes search without user authentication

#### Test 4: Invalid Refresh Token Handling
```bash
# Corrupt the refresh token to test fallback
cp ~/.q_index_credentials.json ~/.q_index_credentials.json.backup
jq '.refresh_token = "invalid_token"' ~/.q_index_credentials.json > temp.json && mv temp.json ~/.q_index_credentials.json

# Run the script
./data-accessor-tester-refresh.sh

# Restore backup
mv ~/.q_index_credentials.json.backup ~/.q_index_credentials.json
```

**Expected Behavior:**
- ✅ Attempts to refresh with invalid token
- ✅ Shows "Failed to refresh credentials, will re-authenticate"
- ✅ Falls back to full authentication flow
- ✅ Saves new valid credentials

### Phase 3: Edge Case Testing

#### Test 5: File Permission Validation
```bash
# Test file permission handling
chmod 644 ~/.q_index_credentials.json
./data-accessor-tester-refresh.sh
ls -la ~/.q_index_credentials.json  # Should be 600 again
```

#### Test 6: Malformed Credentials File
```bash
# Test malformed JSON handling
echo "invalid json" > ~/.q_index_credentials.json
./data-accessor-tester-refresh.sh
# Should handle gracefully and re-authenticate
```

#### Test 7: Missing Credentials File
```bash
# Test missing file handling
rm ~/.q_index_credentials.json
./data-accessor-tester-refresh.sh
# Should proceed with full authentication
```

### Phase 4: Performance and Timing Tests

#### Test 8: Timing Comparison
```bash
# Time the first run (with authentication)
time ./data-accessor-tester-refresh.sh

# Time the second run (with stored credentials)
time ./data-accessor-tester-refresh.sh
```

**Expected:** Second run should be significantly faster (no browser authentication).

#### Test 9: Multiple Consecutive Runs
```bash
# Run multiple times to ensure consistency
for i in {1..3}; do
    echo "Run $i:"
    ./data-accessor-tester-refresh.sh
    echo "---"
done
```

**Expected:** All runs after the first should use stored credentials.

## Validation Checklist

### ✅ Core Functionality
- [ ] Script runs without errors
- [ ] Credentials are stored securely (600 permissions)
- [ ] Refresh token is captured and stored
- [ ] Stored credentials are used on subsequent runs
- [ ] Expired credentials are automatically refreshed
- [ ] Invalid refresh tokens trigger re-authentication

### ✅ User Experience
- [ ] Clear status messages about credential usage
- [ ] No unnecessary authentication prompts
- [ ] Graceful error handling
- [ ] Consistent behavior across runs

### ✅ Security
- [ ] Credentials file has proper permissions (600)
- [ ] No sensitive data in logs
- [ ] Automatic cleanup of invalid credentials
- [ ] Secure token storage format

### ✅ Error Handling
- [ ] Handles missing credentials file
- [ ] Handles corrupted credentials file
- [ ] Handles invalid refresh tokens
- [ ] Handles network failures during refresh

## Troubleshooting

### Clear Stored Credentials
If you encounter issues, you can manually clear stored credentials:
```bash
rm ~/.q_index_credentials.json
```

### Force Re-authentication
Delete the credentials file to force full re-authentication on next run.

### Check Credential Status
The script will automatically inform you whether it's using stored, refreshed, or new credentials.

### Common Issues

**"No valid stored credentials" on second run**
- Check if credentials file exists and has valid JSON format
```bash
cat ~/.q_index_credentials.json | jq '.'
```

**Refresh fails repeatedly**
- Clear credentials and re-authenticate
```bash
rm ~/.q_index_credentials.json
./data-accessor-tester-refresh.sh
```

**Permission denied on credentials file**
- Fix file permissions
```bash
chmod 600 ~/.q_index_credentials.json
```

## Success Criteria

The refresh token implementation is working correctly if:

1. **First run** requires full authentication and saves credentials
2. **Subsequent runs** use stored credentials without authentication
3. **Expired credentials** are automatically refreshed
4. **Invalid refresh tokens** trigger graceful fallback to re-authentication
5. **All security measures** (file permissions, secure storage) are in place
6. **Error handling** works for all edge cases

## Security Considerations

- Credentials are stored with 600 permissions (owner read/write only)
- Refresh tokens have longer lifespans than access tokens
- Automatic cleanup of expired credentials
- No sensitive information in script logs

This enhanced version provides a much smoother user experience while maintaining the same security and functionality as the original script.
