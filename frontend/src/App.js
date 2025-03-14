import { useState, useEffect } from 'react';
import './App.css';
import { SSOOIDCClient, CreateTokenWithIAMCommand } from "@aws-sdk/client-sso-oidc";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { QBusinessClient, SearchRelevantContentCommand } from "@aws-sdk/client-qbusiness";

function App() {
  // State Management
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState(() => {
    const savedData = localStorage.getItem('formData');
    return savedData ? JSON.parse(savedData) : {
      idcApplicationArn: '',
      applicationRegion: '',
      iamIdcRegion: '',
      retrieverId: '',
      qBusinessAppId: ''
    };
  });

  const [code, setCode] = useState(null);
  const [idToken, setIdToken] = useState(null);
  const [searchResults, setSearchResults] = useState(null);
  const [stsCredentials, setSTSCredentials] = useState(null);

  // Step Indicator Update Effects
  useEffect(() => {
    if (code) {
      setCurrentStep(2);
    }
  }, [code]);

  useEffect(() => {
    if (idToken) {
      setCurrentStep(3);
    }
  }, [idToken]);

  useEffect(() => {
    if (searchResults) {
      setCurrentStep(5);
    }
  }, [searchResults]);

  // Main Process Effect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authCode = params.get('code');
    const state = params.get('state');

    // Step 3: Get ID Token and Process Further Steps
    const getIdToken = async (authCode) => {
      try {
        // Initialize STS Client
        const stsClient = new STSClient({
          region: formData.iamIdcRegion,
          credentials: {
            accessKeyId: String(process.env.REACT_APP_AWS_ACCESS_KEY_ID || ''),
            secretAccessKey: String(process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || ''),
            sessionToken: String(process.env.REACT_APP_AWS_SESSION_TOKEN || '')
          }
        });

        // Step 4: Initial Role Assumption
        let assumeRoleResponse;
        try {
          const assumeRoleCommand = new AssumeRoleCommand({
            RoleArn: 'arn:aws:iam::820242917643:role/QIndexCrossAccountRole',
            RoleSessionName: 'automated-session'
          });
          assumeRoleResponse = await stsClient.send(assumeRoleCommand);
          setCurrentStep(4);
          console.log('Successfully assumed role:', assumeRoleResponse);

          // Store initial credentials
          setSTSCredentials({
            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
            sessionToken: assumeRoleResponse.Credentials.SessionToken,
            expiration: new Date(assumeRoleResponse.Credentials.Expiration)
          });

        } catch (error) {
          console.error('Error assuming role:', error);
          throw error;
        }

        // Create OIDC Client
        const client = new SSOOIDCClient({
          region: formData.iamIdcRegion,
          credentials: {
            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
            sessionToken: assumeRoleResponse.Credentials.SessionToken
          }
        });

        // Get ID Token
        const command = new CreateTokenWithIAMCommand({
          clientId: formData.idcApplicationArn,
          code: authCode,
          grantType: "authorization_code",
          redirectUri: 'https://localhost:8081'
        });

        const response = await client.send(command);
        setIdToken(response.idToken);

        // Step 5: Process ID Token and Search
        if (response.idToken) {
          const tokenParts = response.idToken.split('.');
          const payload = JSON.parse(atob(tokenParts[1]));
          const identityContext = payload['sts:identity_context'];

          const providedContexts = [{
            ProviderArn: 'arn:aws:iam::aws:contextProvider/IdentityCenter',
            ContextAssertion: identityContext
          }];

          // Second Role Assumption with Context
          const assumeRoleCommand = new AssumeRoleCommand({
            RoleArn: 'arn:aws:iam::820242917643:role/QIndexCrossAccountRole',
            RoleSessionName: 'automated-session',
            ProvidedContexts: providedContexts
          });

          const assumeRoleResponse = await stsClient.send(assumeRoleCommand);

          // Update credentials with new ones
          const credentials = {
            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
            sessionToken: assumeRoleResponse.Credentials.SessionToken,
            expiration: new Date(assumeRoleResponse.Credentials.Expiration)
          };
          setSTSCredentials(credentials);

          const qbusinessClient = new QBusinessClient({
            region: formData.applicationRegion,
            credentials: credentials
          });

          const searchCommand = new SearchRelevantContentCommand({
            applicationId: formData.qBusinessAppId,
            queryText: "List of connectos for Amazon Q Business",
            contentSource: {
              retriever: {
                retrieverId: formData.retrieverId
              }
            }
          });

          try {
            const searchResponse = await qbusinessClient.send(searchCommand);
            console.log('Search Response:', searchResponse);
            setSearchResults(searchResponse);
          } catch (error) {
            console.error('Error searching content:', error);
          }
        }
      } catch (error) {
        console.error('Error getting ID token:', error);
      }
    };

    if (authCode) {
      setCode(authCode);
      getIdToken(authCode);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (state) {
      try {
        const decodedState = JSON.parse(atob(state));
        setFormData(decodedState);
        localStorage.setItem('formData', JSON.stringify(decodedState));
      } catch (error) {
        console.error('Error decoding state:', error);
      }
    }
  }, [formData.iamIdcRegion, formData.idcApplicationArn, formData.applicationRegion, formData.qBusinessAppId, formData.retrieverId]);

  const handleInputChange = (e) => {
    const newFormData = {
      ...formData,
      [e.target.name]: e.target.value
    };
    setFormData(newFormData);
    localStorage.setItem('formData', JSON.stringify(newFormData));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    // Check if all required fields are filled
    const requiredFields = ['idcApplicationArn', 'applicationRegion', 'iamIdcRegion', 'qBusinessAppId', 'retrieverId'];
    const emptyFields = requiredFields.filter(field => !formData[field]);
    
    if (emptyFields.length > 0) {
      alert('Please fill in all required fields before proceeding.');
      return;
    }

    const idcRegion = formData.iamIdcRegion;
    const redirectUrl = 'https://localhost:8081';
    const oauthState = btoa(JSON.stringify(formData));
    const clientId = formData.idcApplicationArn;
    const authUrl = `https://oidc.${idcRegion}.amazonaws.com/authorize?`
      + `response_type=code`
      + `&redirect_uri=${encodeURIComponent(redirectUrl)}`
      + `&state=${encodeURIComponent(oauthState)}`
      + `&client_id=${clientId}`;
    console.log('Authorization URL:', authUrl);
    window.location.href = authUrl;
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1 className="page-title">ISV - Cross-Account Data Retrieval Tester</h1>
        <div className="step-indicator">
          <div className={`step ${currentStep >= 1 ? 'active' : ''}`}>
            <div className="step-number">1</div>
            <div className="step-label">Form Input</div>
          </div>
          <div className={`step ${currentStep >= 2 ? 'active' : ''}`}>
            <div className="step-number">2</div>
            <div className="step-label">OIDC Auth</div>
          </div>
          <div className={`step ${currentStep >= 3 ? 'active' : ''}`}>
            <div className="step-number">3</div>
            <div className="step-label">IDC Token</div>
          </div>
          <div className={`step ${currentStep >= 4 ? 'active' : ''}`}>
            <div className="step-number">4</div>
            <div className="step-label">STS Credentials</div>
          </div>
          <div className={`step ${currentStep >= 5 ? 'active' : ''}`}>
            <div className="step-number">5</div>
            <div className="step-label">SRC API</div>
          </div>
          <div className="progress-line"></div>
        </div>
  
        {!code ? (
          <div className="step-form-container">
            <h3>Step 1: Enter Configuration Details</h3>
            <form onSubmit={handleSubmit} className="auth-form">
              <div className="input-group">
                <input
                  type="text"
                  name="idcApplicationArn"
                  value={formData.idcApplicationArn}
                  onChange={handleInputChange}
                  placeholder="IDC Application ARN"
                  className="form-input"
                />
              </div>
              <div className="input-group">
                <input
                  type="text"
                  name="applicationRegion"
                  value={formData.applicationRegion}
                  onChange={handleInputChange}
                  placeholder="Amazon Q Business application region"
                  className="form-input"
                />
              </div>
              <div className="input-group">
                <input
                  type="text"
                  name="iamIdcRegion"
                  value={formData.iamIdcRegion}
                  onChange={handleInputChange}
                  placeholder="IAM IDC region"
                  className="form-input"
                />
              </div>
              <div className="input-group">
                <input
                  type="text"
                  name="qBusinessAppId"
                  value={formData.qBusinessAppId}
                  onChange={handleInputChange}
                  placeholder="Q Business Application ID"
                  className="form-input"
                />
              </div>
              <div className="input-group">
                <input
                  type="text"
                  name="retrieverId"
                  value={formData.retrieverId}
                  onChange={handleInputChange}
                  placeholder="Retriever ID"
                  className="form-input"
                />
              </div>
              <button type="submit" className="submit-button">
                Authorize
              </button>
            </form>
          </div>
        ) : (
          <div className="success-container">
            <div className="process-flow">
              <div className="process-step">
                <h3>Step 2: OIDC Authentication</h3>
                <div className="step-content">
                  <div className="status-indicator status-complete">
                    Authentication Complete
                  </div>
                  <p className="code-text">Auth Code: {code}</p>
                </div>
              </div>
  
              <div className="process-step">
                <h3>Step 3: IDC Token Generation</h3>
                <div className="step-content">
                  {idToken ? (
                    <>
                      <div className="status-indicator status-complete">
                        Token Generated
                      </div>
                      <div className="token-container">
                        <textarea
                          readOnly
                          value={idToken}
                          className="token-display"
                          rows={4}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="status-indicator status-pending">
                      Generating Token...
                    </div>
                  )}
                </div>
              </div>
  
              <div className="process-step">
                <h3>Step 4: STS Temporary Credentials</h3>
                <div className="step-content">
                  {stsCredentials ? (
                    <>
                      <div className="status-indicator status-complete">
                        Credentials Obtained
                      </div>
                      <div className="credentials-container">
                        <div className="credentials-details">
                          <div className="credential-item">
                            <label>Access Key ID:</label>
                            <input
                              type="text"
                              readOnly
                              value={stsCredentials.accessKeyId}
                              className="credential-display"
                            />
                          </div>
                          <div className="credential-item">
                            <label>Secret Access Key:</label>
                            <input
                              type="password"
                              readOnly
                              value={stsCredentials.secretAccessKey}
                              className="credential-display"
                            />
                            <button
                              className="toggle-visibility"
                              onClick={(e) => {
                                const input = e.target.previousSibling;
                                input.type = input.type === 'password' ? 'text' : 'password';
                              }}
                            >
                              👁️
                            </button>
                          </div>
                          <div className="credential-item">
                            <label>Session Token:</label>
                            <textarea
                              readOnly
                              value={stsCredentials.sessionToken}
                              className="credential-display token-area"
                              rows={3}
                            />
                          </div>
                          <div className="credential-item">
                            <label>Expiration:</label>
                            <input
                              type="text"
                              readOnly
                              value={stsCredentials.expiration.toLocaleString()}
                              className="credential-display"
                            />
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="status-indicator status-pending">
                      Obtaining Credentials...
                    </div>
                  )}
                </div>
              </div>
  
              <div className="process-step">
                <h3>Step 5: Search Results</h3>
                <div className="step-content">
                  {/* Add new search form */}
                  <div className="search-form">
                    <form onSubmit={async (e) => {
                      e.preventDefault();
                      const queryText = e.target.queryText.value;
                      
                      const qbusinessClient = new QBusinessClient({
                        region: formData.applicationRegion,
                        credentials: stsCredentials
                      });
  
                      const searchCommand = new SearchRelevantContentCommand({
                        applicationId: formData.qBusinessAppId,
                        queryText: queryText,
                        contentSource: {
                          retriever: {
                            retrieverId: formData.retrieverId
                          }
                        }
                      });
  
                      try {
                        const searchResponse = await qbusinessClient.send(searchCommand);
                        setSearchResults(searchResponse);
                      } catch (error) {
                        console.error('Error searching content:', error);
                      }
                    }}>
                      <div className="search-input-group">
                        <input
                          type="text"
                          name="queryText"
                          placeholder="Enter your search query"
                          className="search-input"
                        />
                        <button type="submit" className="search-button">
                          Search
                        </button>
                      </div>
                    </form>
                  </div>
  
                  {searchResults ? (
                  <>
                    <div className="status-indicator status-complete">
                      Search Complete
                    </div>
                    <div className="search-results">
                      {searchResults.relevantContent ? (
                        <div className="results-container">
                          {searchResults.relevantContent.map((item, index) => (
                            <div key={index} className="result-item">
                              <h4>{item.documentTitle}</h4>
                              <p><strong>URI:</strong> <a href={item.documentUri} target="_blank" rel="noopener noreferrer">{item.documentUri}</a></p>
                              <p><strong>Confidence:</strong> {item.scoreAttributes.scoreConfidence}</p>
                              <div className="content-preview">
                                <strong>Content:</strong>
                                <p>{item.content.substring(0, 200)}...</p>
                              </div>
                              <hr />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre>{JSON.stringify(searchResults, null, 2)}</pre>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="status-indicator status-pending">
                    Searching...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </header>
  </div>
);
}

export default App;