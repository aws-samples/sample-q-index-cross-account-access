// 1. Initial Setup and Imports
import { useState, useEffect } from 'react';
import './App.css';
import { SSOOIDCClient, CreateTokenWithIAMCommand } from "@aws-sdk/client-sso-oidc";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { QBusinessClient, SearchRelevantContentCommand } from "@aws-sdk/client-qbusiness";

function App() {
    // UI Step 1: Form Input Configuration - State Management
    const [currentStep, setCurrentStep] = useState(1);
    const [minimizedSteps, setMinimizedSteps] = useState({
        step1: false,
        step2: false,
        step3: false,
        step4: false,
        step5: false
    });

    const [formData, setFormData] = useState(() => {
        const savedData = localStorage.getItem('formData');
        return savedData ? JSON.parse(savedData) : {
            idcApplicationArn: '',
            applicationRegion: '',
            iamIdcRegion: '',
            retrieverId: '',
            qBusinessAppId: '',
            iamRole: '',
            redirectUrl: ''
        };
    });

    // UI Steps 2-5: State Management for Authentication Flow
    const [code, setCode] = useState(null);          // Step 2: OIDC Authentication
    const [idToken, setIdToken] = useState(null);    // Step 3: IDC Token
    const [searchResults, setSearchResults] = useState(null);  // Step 5: Search Results
    const [stsCredentials, setSTSCredentials] = useState(null); // Step 4: STS Credentials

    // Error State Management for All Steps
    const [errors, setErrors] = useState({
        step1: null,
        step2: null,
        step3: null,
        step4: null,
        step5: null
    });

    // UI Step Controls - Minimize/Maximize Step Displays
    const toggleMinimize = (step) => {
        setMinimizedSteps(prev => ({
        ...prev,
        [step]: !prev[step]
        }));
    };

    // Step Progress Management
    useEffect(() => {
        if (code) setCurrentStep(2);
    }, [code]);

    useEffect(() => {
        if (idToken) setCurrentStep(3);
    }, [idToken]);

    useEffect(() => {
        if (searchResults) setCurrentStep(5);
    }, [searchResults]);

    // UI Steps 2-5: Main Authentication Process
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const authCode = params.get('code');
        const state = params.get('state');

        const getIdToken = async (authCode) => {
            try {
                // 1. Obtain STS Temporary Credentials (First Role Assumption)
                // Initialize STS Client with IAM credentials
                const stsClient = new STSClient({
                    region: formData.iamIdcRegion,
                    credentials: {
                        accessKeyId: String(process.env.REACT_APP_AWS_ACCESS_KEY_ID || ''),
                        secretAccessKey: String(process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || ''),
                        sessionToken: String(process.env.REACT_APP_AWS_SESSION_TOKEN || '')
                    }
                });

                // First role assumption to get temporary credentials
                let assumeRoleResponse;
                try {
                    const assumeRoleCommand = new AssumeRoleCommand({
                        RoleArn: formData.iamRole,
                        RoleSessionName: 'automated-session'
                    });
                    assumeRoleResponse = await stsClient.send(assumeRoleCommand);
                    setCurrentStep(4);
                    setErrors(prev => ({ ...prev, step4: null }));

                    // Store temporary credentials
                    setSTSCredentials({
                        accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
                        secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
                        sessionToken: assumeRoleResponse.Credentials.SessionToken,
                        expiration: new Date(assumeRoleResponse.Credentials.Expiration)
                    });
                } catch (error) {
                    setErrors(prev => ({ ...prev, step4: `Error assuming role: ${error.message}` }));
                    throw error;
                }

                // 2. Get IDC Token using Authorization Code
                // Initialize OIDC client with temporary credentials
                const client = new SSOOIDCClient({
                    region: formData.iamIdcRegion,
                    credentials: {
                        accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
                        secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
                        sessionToken: assumeRoleResponse.Credentials.SessionToken
                    }
                });

                // Exchange authorization code for ID token
                const command = new CreateTokenWithIAMCommand({
                    clientId: formData.idcApplicationArn,
                    code: authCode,
                    grantType: "authorization_code",
                    redirectUri: formData.redirectUrl
                });

                const response = await client.send(command);
                setIdToken(response.idToken);
                setErrors(prev => ({ ...prev, step3: null }));

                // 3. Process ID Token and Get Identity Context
                if (response.idToken) {
                    try {
                        // Extract identity context from ID token
                        const tokenParts = response.idToken.split('.');
                        const payload = JSON.parse(atob(tokenParts[1]));
                        const identityContext = payload['sts:identity_context'];

                        const providedContexts = [{
                            ProviderArn: 'arn:aws:iam::aws:contextProvider/IdentityCenter',
                            ContextAssertion: identityContext
                        }];

                        // 4. Second Role Assumption with Identity Context
                        const assumeRoleCommand = new AssumeRoleCommand({
                            RoleArn: formData.iamRole,
                            RoleSessionName: 'automated-session',
                            ProvidedContexts: providedContexts
                        });

                        const assumeRoleResponse = await stsClient.send(assumeRoleCommand);

                        // Store new credentials with identity context
                        const credentials = {
                            accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
                            secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
                            sessionToken: assumeRoleResponse.Credentials.SessionToken,
                            expiration: new Date(assumeRoleResponse.Credentials.Expiration)
                        };
                        setSTSCredentials(credentials);

                        // 5. Call SearchRelevantContent API
                        // Initialize Q Business client with temporary credentials
                        const qbusinessClient = new QBusinessClient({
                            region: formData.applicationRegion,
                            credentials: credentials
                        });

                        // Create and execute search command
                        const searchCommand = new SearchRelevantContentCommand({
                            applicationId: formData.qBusinessAppId,
                            queryText: "Tell me status of project x",
                            contentSource: {
                                retriever: {
                                    retrieverId: formData.retrieverId
                                }
                            }
                        });

                        try {
                            const searchResponse = await qbusinessClient.send(searchCommand);
                            setSearchResults(searchResponse);
                            setErrors(prev => ({ ...prev, step5: null }));
                        } catch (error) {
                            setErrors(prev => ({ ...prev, step5: `Error searching content: ${error.message}` }));
                        }
                    } catch (error) {
                        setErrors(prev => ({ ...prev, step5: `Error processing token: ${error.message}` }));
                    }
                }
            } catch (error) {
                setErrors(prev => ({ ...prev, step3: `Error getting ID token: ${error.message}` }));
            }
        };

        // Get Authorization Code from URL and initiate token exchange
        if (authCode) {
            setCode(authCode);
            getIdToken(authCode);
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // Process state parameter if present
        if (state) {
            try {
                const decodedState = JSON.parse(atob(state));
                setFormData(decodedState);
                localStorage.setItem('formData', JSON.stringify(decodedState));
            } catch (error) {
                setErrors(prev => ({ ...prev, step2: `Error decoding state: ${error.message}` }));
            }
        }
    }, [formData.iamIdcRegion, formData.idcApplicationArn, formData.applicationRegion, formData.qBusinessAppId, 
        formData.retrieverId, formData.iamRole, formData.redirectUrl]);

    // UI Step 1: Form Input Handlers
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
        const requiredFields = ['idcApplicationArn', 'applicationRegion', 'iamIdcRegion', 'qBusinessAppId', 'retrieverId', 'iamRole', 'redirectUrl'];
        const emptyFields = requiredFields.filter(field => !formData[field]);
        if (emptyFields.length > 0) {
            setErrors(prev => ({
                ...prev,
                step1: `Required fields missing: ${emptyFields.join(', ')}`
            }));
            return;
        }

        const idcRegion = formData.iamIdcRegion;
        const oauthState = btoa(JSON.stringify(formData));
        const clientId = formData.idcApplicationArn;
        const authUrl = `https://oidc.${idcRegion}.amazonaws.com/authorize?`
            + `response_type=code`
            + `&redirect_uri=${encodeURIComponent(formData.redirectUrl)}`
            + `&state=${encodeURIComponent(oauthState)}`
            + `&client_id=${clientId}`;
        console.log('Authorization URL:', authUrl);
        window.location.href = authUrl;
    };

    // UI Rendering
    return (
        <div className="App">
            <header className="App-header">
                <h1 className="page-title">ISV - Cross-Account Data Retrieval Tester</h1>

                {/* Progress Indicator for All Steps */}
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
                    // UI Step 1: Configuration Form Display
                    <div className="step-form-container">
                        <h3>Step 1: Enter Configuration Details</h3>
                        <div className="form-header">
                            <div className="tooltip-container">
                                <span className="tooltip-icon">ℹ️</span>
                                <div className="tooltip-content">
                                    <h4>Where to find these values?</h4>
                                    <ul>
                                        <li><strong>IAM Role ARN:</strong> Provided by the ISV for cross-account access</li>
                                        <li><strong>Amazon Q Business application ID:</strong> Unique identifier of the Amazon Q Business application environment</li>
                                        <li><strong>Amazon Q Business application Region:</strong> AWS Region where the Amazon Q Business application environment is created</li>
                                        <li><strong>Amazon Q Business retriever ID:</strong> Unique identifier for the retriever that gets data from the Amazon Q index</li>
                                        <li><strong>Data accessor application ARN:</strong> ISV Amazon Resource Name (ARN) used to identify the ISV</li>
                                        <li><strong>IAM Identity Center Region:</strong> AWS Region where the IDC instance of the customer has been created</li>
                                    </ul>
                                    <a href="https://docs.aws.amazon.com/amazonq/latest/qbusiness-ug/isv-accessing-cross-account.html" target="_blank" rel="noopener noreferrer">
                                        Learn more →
                                    </a>
                                </div>
                            </div>
                        </div>
                        {errors.step1 && <div className="error-message">{errors.step1}</div>}
                        <form onSubmit={handleSubmit} className="auth-form">
                            <div className="form-section">
                                <h4>ISV Provided Details</h4>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        name="iamRole"
                                        value={formData.iamRole}
                                        onChange={handleInputChange}
                                        placeholder="IAM Role ARN"
                                        className="form-input"
                                    />
                                </div>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        name="redirectUrl"
                                        value={formData.redirectUrl}
                                        onChange={handleInputChange}
                                        placeholder="Redirect URL"
                                        className="form-input"
                                    />
                                </div>
                            </div>
                            <div className="form-section">
                                <h4>Enterprise Customer Provided Details</h4>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        name="qBusinessAppId"
                                        value={formData.qBusinessAppId}
                                        onChange={handleInputChange}
                                        placeholder="Amazon Q Business application ID"
                                        className="form-input"
                                    />
                                </div>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        name="applicationRegion"
                                        value={formData.applicationRegion}
                                        onChange={handleInputChange}
                                        placeholder="Amazon Q Business application Region"
                                        className="form-input"
                                    />
                                </div>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        name="retrieverId"
                                        value={formData.retrieverId}
                                        onChange={handleInputChange}
                                        placeholder="Amazon Q Business retriever ID"
                                        className="form-input"
                                    />
                                </div>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        name="idcApplicationArn"
                                        value={formData.idcApplicationArn}
                                        onChange={handleInputChange}
                                        placeholder="Data accessor application ARN"
                                        className="form-input"
                                    />
                                </div>
                                <div className="input-group">
                                    <input
                                        type="text"
                                        name="iamIdcRegion"
                                        value={formData.iamIdcRegion}
                                        onChange={handleInputChange}
                                        placeholder="Region for the IAM Identity Center instance"
                                        className="form-input"
                                    />
                                </div>
                            </div>

                            <button type="submit" className="submit-button">
                                Authorize
                            </button>
                        </form>
                    </div>
                ) : (
                    // UI Steps 2-5: Process Flow Display
                    <div className="success-container">
                        <div className="process-flow">
                            {/* UI Step 2: OIDC Authentication Display */}
                            <div className="process-step">
                                <div className="step-header">
                                    <h3>Step 2: OIDC Authentication</h3>
                                    <button 
                                        className="minimize-button"
                                        onClick={() => toggleMinimize('step2')}
                                    >
                                        {minimizedSteps.step2 ? '▼' : '▲'}
                                    </button>
                                </div>
                                {!minimizedSteps.step2 && (
                                <div className="step-content">
                                    {errors.step2 && <div className="error-message">{errors.step2}</div>}
                                    <div className="status-indicator status-complete">
                                    Authentication Complete
                                    </div>
                                    <p className="code-text">Auth Code: {code}</p>
                                </div>
                                )}
                            </div>

                            {/* UI Step 3: IDC Token Generation Display */}
                            <div className="process-step">
                                <div className="step-header">
                                    <h3>Step 3: IDC Token Generation</h3>
                                    <button 
                                    className="minimize-button"
                                    onClick={() => toggleMinimize('step3')}
                                    >
                                    {minimizedSteps.step3 ? '▼' : '▲'}
                                    </button>
                                </div>
                                {!minimizedSteps.step3 && (
                                    <div className="step-content">
                                    {errors.step3 && <div className="error-message">{errors.step3}</div>}
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
                                )}
                            </div>

                            {/* UI Step 4: STS Credentials Display */}
                            <div className="process-step">
                                <div className="step-header">
                                    <h3>Step 4: STS Temporary Credentials</h3>
                                    <button 
                                    className="minimize-button"
                                    onClick={() => toggleMinimize('step4')}
                                    >
                                    {minimizedSteps.step4 ? '▼' : '▲'}
                                    </button>
                                </div>
                                {!minimizedSteps.step4 && (
                                    <div className="step-content">
                                    {errors.step4 && <div className="error-message">{errors.step4}</div>}
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
                                )}
                            </div>

                            {/* UI Step 5: Search Functionality Display */}
                            <div className="process-step">
                                <div className="step-header">
                                    <h3>Step 5: SearchRelevantContent API</h3>
                                    <button 
                                    className="minimize-button"
                                    onClick={() => toggleMinimize('step5')}
                                    >
                                    {minimizedSteps.step5 ? '▼' : '▲'}
                                    </button>
                                </div>
                                {!minimizedSteps.step5 && (
                                    <div className="step-content">
                                    {errors.step5 && <div className="error-message">{errors.step5}</div>}
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
                                            setErrors(prev => ({ ...prev, step5: null }));
                                        } catch (error) {
                                            setErrors(prev => ({ ...prev, step5: `Error searching content: ${error.message}` }));
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
                                                    <p>{item.content.substring(0, 700)}...</p>
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
                                )}
                            </div>

                        </div>
                    </div>
                )}
            </header>
        </div>
    );
}

export default App;

