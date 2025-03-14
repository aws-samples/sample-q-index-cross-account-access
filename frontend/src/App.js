import { useState, useEffect } from 'react';
import './App.css';
import { SSOOIDCClient, CreateTokenWithIAMCommand } from "@aws-sdk/client-sso-oidc";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { QBusinessClient, SearchRelevantContentCommand } from "@aws-sdk/client-qbusiness";

function App() {
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authCode = params.get('code');
    const state = params.get('state');

    const getIdToken = async (authCode) => {
      try {
        const stsClient = new STSClient({
          region: formData.iamIdcRegion,
          credentials: {
            accessKeyId: String(process.env.REACT_APP_AWS_ACCESS_KEY_ID || ''),
            secretAccessKey: String(process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || ''),
            sessionToken: String(process.env.REACT_APP_AWS_SESSION_TOKEN || '')
          }
        });

        let assumeRoleResponse;
        try {
          const assumeRoleCommand = new AssumeRoleCommand({
            RoleArn: 'arn:aws:iam::820242917643:role/QIndexCrossAccountRole',
            RoleSessionName: 'automated-session'
          });
          assumeRoleResponse = await stsClient.send(assumeRoleCommand);
          console.log('Successfully assumed role:', assumeRoleResponse);
        } catch (error) {
          console.error('Error assuming role:', error);
          throw error;
        }

        const client = new SSOOIDCClient({
          region: formData.iamIdcRegion,
          credentials: {
            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
            sessionToken: assumeRoleResponse.Credentials.SessionToken
          }
        });

        const command = new CreateTokenWithIAMCommand({
          clientId: formData.idcApplicationArn,
          code: authCode,
          grantType: "authorization_code",
          redirectUri: 'https://localhost:8081'
        });

        const response = await client.send(command);
        setIdToken(response.idToken);

        if (response.idToken) {
          const tokenParts = response.idToken.split('.');
          const payload = JSON.parse(atob(tokenParts[1]));
          const identityContext = payload['sts:identity_context'];
          console.log('Identity Context:', identityContext);

          const providedContexts = [{
            ProviderArn: 'arn:aws:iam::aws:contextProvider/IdentityCenter',
            ContextAssertion: identityContext
          }];

          const assumeRoleCommand = new AssumeRoleCommand({
            RoleArn: 'arn:aws:iam::820242917643:role/QIndexCrossAccountRole',
            RoleSessionName: 'automated-session',
            ProvidedContexts: providedContexts
          });

          const assumeRoleResponse = await stsClient.send(assumeRoleCommand);

          const credentials = {
            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
            sessionToken: assumeRoleResponse.Credentials.SessionToken,
            expiration: new Date(assumeRoleResponse.Credentials.Expiration)
          };
          console.log('Assumed Role - ', credentials);

          const qbusinessClient = new QBusinessClient({
            region: formData.applicationRegion,
            credentials: credentials
          });

          const searchCommand = new SearchRelevantContentCommand({
            applicationId: formData.qBusinessAppId,
            queryText: "What is Amazon Q?",
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
        {code ? (
          <div className="success-container">
            <div className="success-message">
              <h2>✅ Authentication Successful!</h2>
              <p className="code-text">Auth Code: {code}</p>
              {idToken && (
                <div className="token-container">
                  <p className="token-text">ID Token received!</p>
                  <textarea
                    readOnly
                    value={idToken}
                    className="token-display"
                    rows={4}
                    style={{
                      width: '100%',
                      maxWidth: '600px',
                      padding: '10px',
                      marginTop: '10px',
                      wordBreak: 'break-all'
                    }}
                  />
                </div>
              )}

              <div className="form-data">
                <h3>Form Data:</h3>
                <p>IDC Application ARN: {formData.idcApplicationArn}</p>
                <p>Application Region: {formData.applicationRegion}</p>
                <p>IAM IDC Region: {formData.iamIdcRegion}</p>
              </div>

              {searchResults && (
                <div className="search-results">
                  <h3>Search Results</h3>
                  <div className="results-container">
                    {searchResults.relevantContent.map((content, index) => (
                      <div key={index} className="result-item">
                        <h4>Result {index + 1}</h4>
                        <p><strong>Content:</strong> {content.content}</p>
                        <p><strong>Score:</strong> {content.score}</p>
                        {content.metadata && (
                          <div className="metadata">
                            <p><strong>Metadata:</strong></p>
                            <pre>{JSON.stringify(content.metadata, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="form-container">
            <h2>Cross-Account Client Authorization</h2>
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
        )}
      </header>
    </div>
  );
}

export default App;