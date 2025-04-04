// 1. Initial Setup and Imports
import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { SSOOIDCClient, CreateTokenWithIAMCommand } from "@aws-sdk/client-sso-oidc";
import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import { QBusinessClient, SearchRelevantContentCommand } from "@aws-sdk/client-qbusiness";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { BedrockClient, ListFoundationModelsCommand } from "@aws-sdk/client-bedrock";
import ReactMarkdown from 'react-markdown';

function App() {
    // UI Step 1: Form Input Configuration - State Management
    const [currentStep, setCurrentStep] = useState(1);
    const [minimizedSteps, setMinimizedSteps] = useState({
        step1: false,
        step2: true,
        step3: true,
        step4: true,
        step5: false,
        step6: false
    });

    // State for manual credentials
    const [manualCredentials, setManualCredentials] = useState({
        accessKeyId: '',
        secretAccessKey: '',
        sessionToken: ''
    });

    // State to check if manual credentials are needed
    const [needsManualCredentials, setNeedsManualCredentials] = useState(false);

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

    const [zoomedImages, setZoomedImages] = useState({
        step1: false,
        step2: false,
        step3: false,
        step4: false,
        step5: false,
        step6: false
    });

    // UI Steps 2-5: State Management for Authentication Flow
    const [code, setCode] = useState(null);          // Step 2: OIDC Authentication
    const [idToken, setIdToken] = useState(null);    // Step 3: IDC Token
    const [searchResults, setSearchResults] = useState(null);  // Step 5: Search Results
    const [stsCredentials, setSTSCredentials] = useState(null); // Step 4: STS Credentials

    const [isSearching, setIsSearching] = useState(false);
    const [selectedResultItem, setSelectedResultItem] = useState(null);
    const [currentQueryText, setCurrentQueryText] = useState('');

    // UI Step 6
    const [searchSummary, setSearchSummary] = useState(null);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [bedrockModels, setBedrockModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('');

    // Error State Management for All Steps
    const [errors, setErrors] = useState({
        step1: null,
        step2: null,
        step3: null,
        step4: null,
        step5: null,
        step6: null
    });

    // UI Step Controls - Minimize/Maximize Step Displays
    const toggleMinimize = (step) => {
        setMinimizedSteps(prev => ({
        ...prev,
        [step]: !prev[step]
        }));
    };

    const handleImageClick = (step) => {
        setZoomedImages(prev => ({
            ...prev,
            [step]: !prev[step]
        }));
    };

    const isRunningOnAmplify = () => {
        return process.env.REACT_APP_ENV === 'amplify';
    };

    const handleItemClick = (item) => {
        setSelectedResultItem(item);
    };

    const handleClosePopup = () => {
        setSelectedResultItem(null);
    };
      
    const summarizeWithBedrock = async (searchResults) => {
        try {
            setSearchSummary(null);
            setErrors(prev => ({ ...prev, step6: null }));
            setIsGeneratingSummary(true);
            const bedrockClient = new BedrockRuntimeClient({
                region: formData.applicationRegion,
                credentials: isRunningOnAmplify()
                      ? undefined // When undefined, AWS SDK will use the Amplify role credentials
                      : needsManualCredentials
                        ? {
                            accessKeyId: manualCredentials.accessKeyId,
                            secretAccessKey: manualCredentials.secretAccessKey,
                            sessionToken: manualCredentials.sessionToken
                          }
                        : {
                            accessKeyId: String(process.env.REACT_APP_AWS_ACCESS_KEY_ID || ''),
                            secretAccessKey: String(process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || ''),
                            sessionToken: String(process.env.REACT_APP_AWS_SESSION_TOKEN || '')
                          }
            });
        
            // Prepare the content to summarize
            const contentToSummarize = searchResults.relevantContent
            .map(item => item.content)
            .join('\n\n');
        
            const prompt = `Please provide a concise summary for the search query "${currentQueryText}" based on the following search results:\n\n${contentToSummarize}`;
        
            // Prepare the request body based on the selected model
            let requestBody = {};
            
            if (selectedModel.includes('anthropic')) {
                // Anthropic Claude models
                requestBody = {
                    anthropic_version: "bedrock-2023-05-31",
                    max_tokens: 1000,
                    messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                    ]
                };
            } else if (selectedModel.includes('amazon.nova')) {
                // Amazon Nova models
                requestBody = {
                  messages: [
                    {
                      role: "user",
                      content: [{
                        text: prompt
                      }]
                    }
                  ]
                };
            } else if (selectedModel.includes('amazon.titan')) {
                // Amazon Titan models
                requestBody = {
                    inputText: prompt,
                    textGenerationConfig: {
                        maxTokenCount: 1000,
                        temperature: 0.7,
                        topP: 0.9,
                        stopSequences: []
                    }
                };
            } else if (selectedModel.includes('meta.llama')) {
                // Meta Llama models
                requestBody = {
                    prompt: prompt,
                    max_gen_len: 1000,
                    temperature: 0.7,
                    top_p: 0.9
                };
            } else if (selectedModel.includes('cohere')) {
                // Cohere models
                if (selectedModel.includes('command-r')) {
                    // Cohere Command-R model
                    requestBody = {
                        message: prompt,
                        max_tokens: 2048,
                        temperature: 0.7
                    };
                } else {
                    // Cohere Command model
                    requestBody = {
                        prompt: prompt,
                        max_tokens: 2048,
                        temperature: 0.7
                    };
                }
            } else if (selectedModel.includes('ai21')) {
                // AI21 models
                requestBody = {
                    messages: [
                        {
                            role: "user",
                            content: prompt
                        }
                    ]
                };
            } else if (selectedModel.includes('mistral')) {
                requestBody = {
                    "prompt": "<s>[INST] " + prompt + " [/INST]",
                    "max_tokens": 512,
                    "temperature": 0.5
                }
            } else {
                // Generic fallback for other models
                requestBody = {
                    messages: [
                    {
                        role: "user",
                        content: prompt
                    }
                    ]
                };
            }

            const command = new InvokeModelCommand({
                modelId: selectedModel,
                contentType: "application/json",
                accept: "application/json",
                body: JSON.stringify(requestBody)
            });
        
            const response = await bedrockClient.send(command);
            const responseBody = new Uint8Array(Object.values(response.body));
            const decodedResponse = new TextDecoder('utf-8').decode(responseBody);
            const parsedResponse = JSON.parse(decodedResponse);
            //console.log('Decoded Response:', parsedResponse);
            
            // Access specific parts of the response if needed
            const content = parsedResponse.content;

            // Handle different response formats based on model
            let summaryText;
            if (selectedModel.includes('anthropic')) {
                summaryText = parsedResponse.content[0].text;
            } else if (selectedModel.includes('amazon.nova')) {
                summaryText = parsedResponse.output.message.content[0].text;
            } else if (selectedModel.includes('amazon.titan')) {
                summaryText = parsedResponse.results[0].outputText;
            } else if (selectedModel.includes('meta.llama')) {
                summaryText = parsedResponse.generation;
            } else if (selectedModel.includes('cohere')) {
                if (selectedModel.includes('command-r')) {
                    // For Command-R, use the text field directly
                    summaryText = parsedResponse.text;
                } else {
                    // For regular Command, keep using generations array
                    summaryText = parsedResponse.generations[0].text;
                }
            } else if (selectedModel.includes('ai21')) {
                summaryText = parsedResponse.choices[0].message.content;
            } else if (selectedModel.includes('mistral')) {
                summaryText = parsedResponse.outputs[0].text;
            } else {
                summaryText = parsedResponse.content || parsedResponse.text || parsedResponse.generation;
            }

            setSearchSummary(summaryText);

            
        } catch (error) {
            setErrors(prev => ({ ...prev, step6: `Error generating summary: ${error.message}` }));
        } finally {
            setIsGeneratingSummary(false);
        }
    };

    const fetchBedrockModels = useCallback(async () => {
        try {
            const bedrockClient = new BedrockClient({  // Changed from BedrockRuntimeClient
                region: formData.applicationRegion,
                credentials: isRunningOnAmplify()
                  ? undefined
                  : needsManualCredentials
                  ? {
                      accessKeyId: manualCredentials.accessKeyId,
                      secretAccessKey: manualCredentials.secretAccessKey,
                      sessionToken: manualCredentials.sessionToken
                    }
                  : {
                      accessKeyId: String(process.env.REACT_APP_AWS_ACCESS_KEY_ID || ''),
                      secretAccessKey: String(process.env.REACT_APP_AWS_SECRET_ACCESS_KEY || ''),
                      sessionToken: String(process.env.REACT_APP_AWS_SESSION_TOKEN || '')
                    }
            });
          
            // Get list of available models
            const command = new ListFoundationModelsCommand({});
            const response = await bedrockClient.send(command);  

            // Filter for only enabled models
            const enabledModels = response.modelSummaries.filter(model => 
                model.modelLifecycle.status === 'ACTIVE' && 
                model.inferenceTypesSupported.includes('ON_DEMAND') &&
                model.inputModalities.includes('TEXT') && 
                model.outputModalities.includes('TEXT')
            );
            
            setBedrockModels(enabledModels);

            // Look for Claude 3 Sonnet model
            const claudeSonnetModel = enabledModels.find(model => 
                model.modelId.includes('anthropic.claude-3-5-sonnet')
            );

            // Set default model - prefer Claude 3 Sonnet if available, otherwise first enabled model
            if (claudeSonnetModel) {
                setSelectedModel(claudeSonnetModel.modelId);
            } else if (enabledModels.length > 0) {
                setSelectedModel(enabledModels[0].modelId);
            }
        } catch (error) {
          console.error('Error fetching Bedrock models:', error);
          setErrors(prev => ({ ...prev, step6: `Error fetching Bedrock models: ${error.message}` }));
        }
    }, [
        formData.applicationRegion, 
        manualCredentials.accessKeyId,
        manualCredentials.secretAccessKey,
        manualCredentials.sessionToken,
        needsManualCredentials
    ]);

    // Check for environment credentials
    useEffect(() => {
        const hasEnvCredentials = process.env.REACT_APP_AWS_ACCESS_KEY_ID && 
                                process.env.REACT_APP_AWS_SECRET_ACCESS_KEY && 
                                process.env.REACT_APP_AWS_SESSION_TOKEN;
        setNeedsManualCredentials(!hasEnvCredentials);
    }, []);

    useEffect(() => {
        if (stsCredentials) {
          fetchBedrockModels();
        }
    }, [stsCredentials, fetchBedrockModels]);

    // Step Progress Management
    useEffect(() => {
        if (code) setCurrentStep(2);
    }, [code]);

    useEffect(() => {
        if (idToken) setCurrentStep(3);
    }, [idToken]);

    useEffect(() => {
        if (stsCredentials) setCurrentStep(4);
    }, [stsCredentials]);

    useEffect(() => {
        if (searchResults) setCurrentStep(5);
    }, [searchResults]);

    useEffect(() => {
        if (searchSummary) setCurrentStep(6);
    }, [searchSummary]);

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
                    credentials: isRunningOnAmplify()
                      ? undefined // When undefined, AWS SDK will use the Amplify role credentials
                      : needsManualCredentials
                        ? {
                            accessKeyId: manualCredentials.accessKeyId,
                            secretAccessKey: manualCredentials.secretAccessKey,
                            sessionToken: manualCredentials.sessionToken
                          }
                        : {
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
        formData.retrieverId, formData.iamRole, formData.redirectUrl, manualCredentials.accessKeyId,
        manualCredentials.secretAccessKey, manualCredentials.sessionToken, needsManualCredentials]);

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
                    <div className={`step ${currentStep >= 6 ? 'active' : ''}`}>
                        <div className="step-number">6</div>
                        <div className="step-label">LLM Summary</div>
                    </div>
                    <div className="progress-line"></div>
                </div>

                {!code ? (
                    <div className="step-form-container">
                        <h3>Step 1: Enter Configuration Details</h3>
                       
                        {errors.step1 && <div className="error-message">{errors.step1}</div>}
                        
                        <div className="step-content-wrapper">
                            <div className="step-image-container">
                                <div className="step-image">
                                    <div className="image-container">
                                        <img
                                            src="architecture-1.png"
                                            alt="Step 1 Architecture"
                                            className="base-image"
                                            onClick={() => handleImageClick('step1')} // Modified click handler
                                        />
                                        <div className="tooltip">Click to zoom</div>
                                        <div 
                                            className={`fullscreen-overlay ${zoomedImages.step1 ? 'active' : ''}`} 
                                            onClick={() => handleImageClick('step1')}
                                        >
                                            <img
                                            src="architecture-1.png"
                                            alt="Step 1 Architecture"
                                            className="fullscreen-image"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="code-snippet">
                                    <h4 className="snippet-title">Initiate OIDC Authentication</h4>
                                    <pre>
                                        <code>
{`const idcRegion = formData.iamIdcRegion;
const oauthState = btoa(JSON.stringify(formData));
const clientId = formData.idcApplicationArn;

const authUrl = \`https://oidc.\${idcRegion}.amazonaws.com/authorize?\`
  + \`response_type=code&redirect_uri=\${encodeURIComponent(formData.redirectUrl)}&state=\${encodeURIComponent(oauthState)}&client_id=\${clientId}\`;

window.location.href = authUrl;`}
                                        </code>
                                    </pre>
                                </div>
                            </div>
                            <form onSubmit={handleSubmit} className="auth-form">
                                
                                <div className="form-section">
                                    <h4>ISV Provided Details</h4>
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
                                    
                                    {needsManualCredentials && (
                                        <>
                                        <div className="input-group">
                                            <input
                                            type="text"
                                            name="accessKeyId"
                                            value={manualCredentials.accessKeyId}
                                            onChange={(e) => setManualCredentials(prev => ({
                                                ...prev,
                                                accessKeyId: e.target.value
                                            }))}
                                            placeholder="AWS Access Key ID"
                                            className="form-input"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <input
                                            type="password"
                                            name="secretAccessKey"
                                            value={manualCredentials.secretAccessKey}
                                            onChange={(e) => setManualCredentials(prev => ({
                                                ...prev,
                                                secretAccessKey: e.target.value
                                            }))}
                                            placeholder="AWS Secret Access Key"
                                            className="form-input"
                                            />
                                        </div>
                                        <div className="input-group">
                                            <input
                                            type="text"
                                            name="sessionToken"
                                            value={manualCredentials.sessionToken}
                                            onChange={(e) => setManualCredentials(prev => ({
                                                ...prev,
                                                sessionToken: e.target.value
                                            }))}
                                            placeholder="AWS Session Token"
                                            className="form-input"
                                            />
                                        </div>
                                        </>
                                    )}

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
                    </div>
                    ) : (
                    // UI Steps 2-5: Process Flow Display
                    <div className="success-container">
                        <div className="process-flow">
                            {/* Step 2: OIDC Authentication */}
                            <div className="process-step">
                                <div className="step-header">
                                    <h3>Step 2: OIDC Authentication</h3>
                                    <button className="minimize-button" onClick={() => toggleMinimize('step2')}>
                                    {minimizedSteps.step2 ? '▼' : '▲'}
                                    </button>
                                </div>
                                {!minimizedSteps.step2 && (
                                    <div className="step-content">
                                    {errors.step2 && <div className="error-message">{errors.step2}</div>}
                                    <div className="step-content-wrapper">
                                        <div className="step-image-container">
                                            <div className="step-image">
                                                <div className="image-container">
                                                <img
                                                    src="architecture-2.png"
                                                    alt="Step 2 Architecture"
                                                    className="base-image"
                                                    onClick={() => handleImageClick('step2')}
                                                />
                                                <div className="tooltip">Click to zoom</div>
                                                <div 
                                                    className={`fullscreen-overlay ${zoomedImages.step2 ? 'active' : ''}`} 
                                                    onClick={() => handleImageClick('step2')}
                                                >
                                                    <img
                                                    src="architecture-2.png"
                                                    alt="Step 2 Architecture"
                                                    className="fullscreen-image"
                                                    />
                                                </div>
                                                </div>
                                            </div>
                                            <div className="code-snippet">
                                                <h4 className="snippet-title">Authentication Code</h4>
                                                <pre>
                                                <code>
{`// Get Authorization Code from URL
const params = new URLSearchParams(window.location.search);
const authCode = params.get('code');
const state = params.get('state');

// Process state parameter if present
if (state) {
    const decodedState = JSON.parse(atob(state));
    setFormData(decodedState);
}

// Store the authorization code
setCode(authCode);`}
                                                </code>
                                                </pre>
                                            </div>
                                        </div>
                                        <div className="auth-status-container">
                                            <div className="auth-code-display">
                                                <h4>Authorization Code</h4>
                                                <p className="code-text">{code}</p>
                                            </div>
                                            <div className="status-indicator status-complete">
                                                Authentication Complete
                                            </div>
                                        </div>
                                    </div>
                                    </div>
                                )}
                                </div>

                            {/* Step 3: IDC Token Generation */}
                            <div className="process-step">
                            <div className="step-header">
                                <h3>Step 3: IDC Token Generation</h3>
                                <button className="minimize-button" onClick={() => toggleMinimize('step3')}>
                                {minimizedSteps.step3 ? '▼' : '▲'}
                                </button>
                            </div>
                            {!minimizedSteps.step3 && (
                                <div className="step-content">
                                {errors.step3 && <div className="error-message">{errors.step3}</div>}
                                <div className="step-content-wrapper">
                                    <div className="step-image-container">
                                    <div className="step-image">
                                        <div className="image-container">
                                        <img
                                            src="architecture-3.png"
                                            alt="Step 3 Architecture"
                                            className="base-image"
                                            onClick={() => handleImageClick('step3')}
                                        />
                                        <div className="tooltip">Click to zoom</div>
                                        <div 
                                            className={`fullscreen-overlay ${zoomedImages.step3 ? 'active' : ''}`}
                                            onClick={() => handleImageClick('step3')}
                                        >
                                            <img
                                            src="architecture-3.png"
                                            alt="Step 3 Architecture"
                                            className="fullscreen-image"
                                            />
                                        </div>
                                        </div>
                                    </div>
                                    <div className="code-snippet">
                                        <h4 className="snippet-title">Token Generation Code</h4>
                                        <pre>
                                        <code>
{`const client = new SSOOIDCClient({
  region: formData.iamIdcRegion,
  credentials: assumeRoleResponse.Credentials
});

const command = new CreateTokenWithIAMCommand({
  clientId: formData.idcApplicationArn,
  code: authCode,
  grantType: "authorization_code",
  redirectUri: formData.redirectUrl
});

const response = await client.send(command);
setIdToken(response.idToken);`}
                                        </code>
                                        </pre>
                                    </div>
                                    </div>
                                    <div className="auth-status-container">
                                    <div className="auth-code-display">
                                        <h4>ID Token</h4>
                                        <p className="code-text">{idToken || 'Generating...'}</p>
                                    </div>
                                    <div className="status-indicator status-complete">
                                        {idToken ? 'Token Generated' : 'Generating Token...'}
                                    </div>
                                    </div>
                                </div>
                                </div>
                            )}
                            </div>

                            {/* Step 4: STS Credentials */}
                            <div className="process-step">
                            <div className="step-header">
                                <h3>Step 4: STS Credentials</h3>
                                <button className="minimize-button" onClick={() => toggleMinimize('step4')}>
                                {minimizedSteps.step4 ? '▼' : '▲'}
                                </button>
                            </div>
                            {!minimizedSteps.step4 && (
                                <div className="step-content">
                                {errors.step4 && <div className="error-message">{errors.step4}</div>}
                                <div className="step-content-wrapper">
                                    <div className="step-image-container">
                                    <div className="step-image">
                                        <div className="image-container">
                                        <img
                                            src="architecture-4.png"
                                            alt="Step 4 Architecture"
                                            className="base-image"
                                            onClick={() => handleImageClick('step4')}
                                        />
                                        <div className="tooltip">Click to zoom</div>
                                        <div 
                                            className={`fullscreen-overlay ${zoomedImages.step4 ? 'active' : ''}`}
                                            onClick={() => handleImageClick('step4')}
                                        >
                                            <img
                                            src="architecture-4.png"
                                            alt="Step 4 Architecture"
                                            className="fullscreen-image"
                                            />
                                        </div>
                                        </div>
                                    </div>
                                    <div className="code-snippet">
                                        <h4 className="snippet-title">STS Credentials Code</h4>
                                        <pre>
                                        <code>
{`const assumeRoleCommand = new AssumeRoleCommand({
  RoleArn: formData.iamRole,
  RoleSessionName: 'automated-session',
  ProvidedContexts: providedContexts
});

const assumeRoleResponse = await stsClient.send(assumeRoleCommand);

const credentials = {
  accessKeyId: assumeRoleResponse.Credentials.AccessKeyId,
  secretAccessKey: assumeRoleResponse.Credentials.SecretAccessKey,
  sessionToken: assumeRoleResponse.Credentials.SessionToken,
  expiration: new Date(assumeRoleResponse.Credentials.Expiration)
};`}
                                        </code>
                                        </pre>
                                    </div>
                                    </div>
                                    <div className="auth-status-container">
                                    <div className="auth-code-display">
                                        <h4>STS Credentials</h4>
                                        {stsCredentials ? (
                                        <div className="credentials-details">
                                            <p><strong>Access Key ID:</strong> {stsCredentials.accessKeyId}</p>
                                            <p><strong>Secret Access Key:</strong> ********</p>
                                            <p><strong>Expiration:</strong> {stsCredentials.expiration.toLocaleString()}</p>
                                        </div>
                                        ) : (
                                        <p>Obtaining credentials...</p>
                                        )}
                                    </div>
                                    <div className="status-indicator status-complete">
                                        {stsCredentials ? 'Credentials Generated' : 'Generating Credentials...'}
                                    </div>
                                    </div>
                                </div>
                                </div>
                            )}
                            </div>

                            {/* Step 5: SearchRelevantContent API */}
                            <div className="process-step">
                                <div className="step-header">
                                    <h3>Step 5: SearchRelevantContent API</h3>
                                    <button className="minimize-button" onClick={() => toggleMinimize('step5')}>
                                    {minimizedSteps.step5 ? '▼' : '▲'}
                                    </button>
                                </div>
                                {!minimizedSteps.step5 && (
                                    <div className="step-content">
                                    {errors.step5 && <div className="error-message">{errors.step5}</div>}
                                    <div className="step-content-wrapper">
                                        {/* Left side: Architecture and Code */}
                                        <div className="left-panel">
                                        <div className="step-image-container">
                                            <div className="step-image">
                                            <div className="image-container">
                                                <img
                                                src="architecture-5.png"
                                                alt="Step 5 Architecture"
                                                className="base-image"
                                                onClick={() => handleImageClick('step5')}
                                                />
                                                <div className="tooltip">Click to zoom</div>
                                                <div
                                                className={`fullscreen-overlay ${zoomedImages.step5 ? 'active' : ''}`}
                                                onClick={() => handleImageClick('step5')}
                                                >
                                                <img
                                                    src="architecture-5.png"
                                                    alt="Step 5 Architecture"
                                                    className="fullscreen-image"
                                                />
                                                </div>
                                            </div>
                                            </div>
                                        </div>
                                        <div className="code-snippet">
                                            <h4 className="snippet-title">Search API Code</h4>
                                            <pre>
                                            <code>
{`const qbusinessClient = new QBusinessClient({
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

const searchResponse = await qbusinessClient.send(searchCommand);`}
                                            </code>
                                            </pre>
                                        </div>
                                        </div>

                                        {/* Right side: Search functionality */}
                                        <div className="right-panel">
                                        <div className="search-section">
                                            <div className="search-form">
                                            <form onSubmit={async (e) => {
                                                e.preventDefault();
                                                const queryText = e.target.queryText.value;
                                                setCurrentQueryText(queryText); // Store the query text
                                                setIsSearching(true); // Set loading state to true before search
                                                setSearchResults(null); // Clear previous search results
                                                setSearchSummary(null);
                                                // Clear error messages when starting a new search
                                                setErrors(prev => ({
                                                    ...prev,
                                                    step5: null,  // Clear search-related errors
                                                    step6: null   // Clear summary-related errors
                                                }));

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
                                                } finally {
                                                    setIsSearching(false); // Set loading state to false after search completes
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
                                                    {isSearching ? (
                                                        <span className="loading-spinner">⌛</span>
                                                    ) : (
                                                        'Search'
                                                    )}
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
                                                        <div 
                                                            key={index} 
                                                            className="result-item"
                                                            onClick={() => handleItemClick(item)}
                                                        >
                                                            <h4>{item.documentTitle}</h4>
                                                            <p><strong>URI:</strong> <a 
                                                            href={item.documentUri} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            onClick={(e) => e.stopPropagation()} // Prevent popup when clicking the link
                                                            >{item.documentUri}</a></p>
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
                                                Ready to search
                                            </div>
                                            )}
                                            {selectedResultItem && (
                                                <div className="json-popup-overlay" onClick={handleClosePopup}>
                                                    <div className="json-popup-content" onClick={(e) => e.stopPropagation()}>
                                                    <button className="json-popup-close" onClick={handleClosePopup}>✕</button>
                                                    <h3>Raw JSON Data</h3>
                                                    <pre style={{ whiteSpace: 'pre-wrap' }}>
                                                        {JSON.stringify(selectedResultItem, null, 2)}
                                                    </pre>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        </div>
                                    </div>
                                    </div>
                                )}
                            </div>
                            {/* Step 6: Bedrock Summary */}
                            <div className="process-step">
                                <div className="step-header">
                                    <h3>Step 6: LLM-Generated Summary</h3>
                                    <button className="minimize-button" onClick={() => toggleMinimize('step6')}>
                                    {minimizedSteps.step6 ? '▼' : '▲'}
                                    </button>
                                </div>
                                {!minimizedSteps.step6 && (
                                    <div className="step-content">
                                    {errors.step6 && <div className="error-message">{errors.step6}</div>}
                                    <div className="step-content-wrapper">
                                        <div className="left-panel">
                                            <div className="step-image-container">
                                                <div className="step-image">
                                                <div className="image-container">
                                                    <img
                                                    src="architecture-6.png"
                                                    alt="Step 6 Architecture"
                                                    className="base-image"
                                                    onClick={() => handleImageClick('step6')}
                                                    />
                                                    <div className="tooltip">Click to zoom</div>
                                                    <div
                                                    className={`fullscreen-overlay ${zoomedImages.step5 ? 'active' : ''}`}
                                                    onClick={() => handleImageClick('step6')}
                                                    >
                                                    <img
                                                        src="architecture-6.png"
                                                        alt="Step 6 Architecture"
                                                        className="fullscreen-image"
                                                    />
                                                    </div>
                                                </div>
                                                </div>
                                            </div>
                                            <div className="code-snippet">
                                                <h4 className="snippet-title">Bedrock Integration Code</h4>
                                                <pre>
                                                <code>
{`const bedrockClient = new BedrockRuntimeClient({
    region: formData.applicationRegion,
    credentials: stsCredentials
});

const prompt = 'Please provide a concise summary for the search query "\${currentQueryText}" based on the following search results: \${contentToSummarize}';
        

const command = new InvokeModelCommand({
    modelId: "amazon.nova-pro-v1:0",
    contentType: "application/json",
    body: JSON.stringify({
        messages: [{
            role: "user",
            content: [{
                text: prompt
            }]
        }]
    })
});`}
                                                </code>
                                                </pre>
                                            </div>
                                        </div>

                                        <div className="right-panel">
                                        <div className="summary-section">
                                            {searchResults ? (
                                            <>
                                                <div className="summary-controls">
                                                    <select 
                                                    value={selectedModel}
                                                    onChange={(e) => setSelectedModel(e.target.value)}
                                                    className="model-select"
                                                    >
                                                    {bedrockModels.map(model => (
                                                        <option key={model.modelId} value={model.modelId}>
                                                        {model.modelId}
                                                        </option>
                                                    ))}
                                                    </select>
                                                    <button
                                                        className="summarize-button"
                                                        onClick={() => summarizeWithBedrock(searchResults)}
                                                        disabled={!searchResults || !searchResults.relevantContent}
                                                    >
                                                        {isGeneratingSummary ? (
                                                            <span className="loading-spinner">⌛</span>
                                                        ) : (
                                                            'Generate Summary'
                                                        )}
                                                    </button>
                                                </div>
                                                {searchSummary && (
                                                <div className="summary-content">
                                                    <h4>Summary</h4>
                                                    <div className="summary-text">
                                                        <ReactMarkdown>
                                                            {searchSummary}
                                                        </ReactMarkdown>
                                                    </div>
                                                </div>
                                                )}
                                            </>
                                            ) : (
                                            <div className="status-indicator status-pending">
                                                Please perform a search first to generate a summary
                                            </div>
                                            )}
                                        </div>
                                        </div>
                                    </div>
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

