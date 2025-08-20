import boto3
import uuid
import streamlit as st
from streamlit_chat import message
from streamlit_pdf_viewer import pdf_viewer
from urllib.parse import urlparse, parse_qs
from authflowHelper import get_idp_idc_authorization_url, get_sts_credentials, getEnterpriseQIndex, STSCredentials
from ttiflowHelper import getOIDCToken
import os


bedrockModelId = os.environ.get('BEDROCK_MODEL')


# If auth code in URL query string, fetch STS credentials for Q Index call

if 'stsCredentials' not in st.session_state and 'code' in st.query_params:
    st.session_state.stsCredentials = get_sts_credentials(st.query_params['code'])

    #print("stsCredentials:", st.session_state.stCredentials)



bedrock_client = boto3.client('bedrock-runtime', region_name=os.environ.get('BEDROCK_MODEL_REGION'))


with open('SportsintheUnitedStates.txt', 'r') as file:
    demoText = file.readlines()


with open("SportsintheUnitedStates-1-10-Wikipedia.pdf", "rb") as file:
    pdf_data = file.read()



SYSTEM_PROMPT = """
You are a helpful AI assistant who answers question correctly and accurately. Do not makeup answers and only answer from the provided information in the prompt. Answer 'Do Not Know' if information not available in provided context.
"""

if 'chatHistory' not in st.session_state:
   st.session_state.setdefault("chatHistory", [{"chat":"How can I help you?", "is_user":False}])
   



def on_input_change():
    user_input = st.session_state.user_input
    chat_response = get_response(user_input)
    st.session_state.chatHistory.append({"chat":f"{user_input}", "is_user":True})
    st.session_state.chatHistory.append({"chat":f"{chat_response}", "is_user":False})
    st.session_state.user_input = ''



if 'stsCredentials' in st.session_state:
    st.set_page_config(
        page_title="ISV <-- Enterprise Index Retrieval Demo",
        layout="wide"
    )
    st.query_params.clear()
else:
    st.set_page_config(
        page_title="ISV Application",
        layout="wide"
    )


col1, col2, col3 = st.columns([0.15,0.65,0.2])


@st.dialog("Enter Redirect URL from IAM IDC", width="large")
def signup_dialog():
    redirectURL = st.text_input("Redirect URL")
    parsed_url = urlparse(redirectURL)
    query_params = parse_qs(parsed_url.query)
    if st.button("Submit"):
        st.query_params['code'] = query_params['code']
        st.rerun()  # Close the modal after submission


def startTTI_flow(userName: str, password: str):
    st.session_state.stsCredentials = getOIDCToken(userName, password)
    st.rerun()


with col1:
    st.markdown("""
        <style>
        .stButton > button {
            text-align: left;
        }
        </style>
        """, unsafe_allow_html=True)

    if 'stsCredentials' not in st.session_state:
        if len(os.environ.get('REDIRECT_URI')) != 0:
            st.markdown(f'<a href="{get_idp_idc_authorization_url()}" target="_blank">Click here to connect with Q using Auth</a>', unsafe_allow_html=True)
            if st.button("Altneratively enter redirect URL containing auth code if your auth endpoint does not exist yet"):
                signup_dialog()
        else:    
            st.text("Using TTI (Cognito)")
            st.text("Login into ISV, enter credentials")
            userName = st.text_input("Enter User Name")
            password = st.text_input("Enter a password", type="password")
            if st.button("Login"):
                startTTI_flow(userName, password)
    else:
        st.info("Q Index connected")


with col2:
    st.header("Welcome to your ISV landing page.")
    chat_placeholder = st.empty()
    with chat_placeholder.container(): 
        for chat in st.session_state.chatHistory:
            message(chat["chat"], is_user=chat["is_user"], key=uuid.uuid4().hex)
    with st.container():
        st.text_input("User Input:", on_change=on_input_change, key="user_input")


with col3:
    pdf_viewer(pdf_data, width=700, height=1000, )




def get_response(user_input):
    # check to see if we have Q Index connected
    if 'stsCredentials' in st.session_state:
        return get_response_from_q_index(user_input)
    else:
        return get_response_with_llm_kb(user_input)



def get_response_from_q_index(user_input: str):
    stsCred: STSCredentials = st.session_state.stsCredentials
    # print(stsCred)
    qbiz = boto3.client(
        "qbusiness",
        aws_access_key_id=stsCred.aws_access_key_id,
        aws_secret_access_key=stsCred.aws_secret_access_key,
        aws_session_token=stsCred.aws_session_token,
        region_name=getEnterpriseQIndex().application_region
        )
    


    search_params = {  'applicationId': getEnterpriseQIndex().application_id, 
    'contentSource': {
        'retriever': { 
            'retrieverId': getEnterpriseQIndex().retriever_id
            }
    }, 
    'queryText': f'{user_input}', 
    'maxResults': 5
    }

    search_response = qbiz.search_relevant_content(**search_params)
    
    full_context = ""

    for chunks in search_response['relevantContent']:
        full_context = full_context + chunks['content'] + "\n"

    SYSTEM_PROMPT=""""
    You are a helpful AI assistant who answers question correctly and accurately about a AcmeCompany's IT tickets. Do not makeup answers and only answer from the provided knowledge.
    """

    messages = [{"role": "user","content":[{"text": f"Given the full context: {full_context}\n\nAnswer this question accurately: {user_input}"}]}]

    converse_params = {
            "modelId": bedrockModelId,
            "messages": messages,                
            "system": [{"text": SYSTEM_PROMPT}]
        }

    ai_response = bedrock_client.converse(**converse_params)

    return(ai_response['output']['message']['content'][0]['text'])



def get_response_with_llm_kb(user_input):
    chatPrompt = f"""
    <document>
    {demoText}
    </document>

    {user_input}
    """


    messages = [
        {
            "role": "user",
            "content":[
                {"text": chatPrompt}
            ]
        }
    ]


    converse_params = {
        "modelId": bedrockModelId,
        "messages": messages,                
        "system": [{"text": SYSTEM_PROMPT}]
    }       
    
    ai_response = bedrock_client.converse(**converse_params)

    return ai_response['output']['message']['content'][0]['text']

