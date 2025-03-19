import boto3
import requests
import os
import base64
import json


client = boto3.client(service_name='qbusiness')

ApplicationId = os.environ['ApplicationId']
IndexId = os.environ['IndexId']

def handler(event, context):
  print(f'Incoming request: {event}')
  responseBody = {}
  
  try:
    # Create the document content
    CONTENT="""Line 1: Project Status Update - Project X Date: March 19, 2025 Status: GREEN
            Line 2: Project X, under the leadership of Sam Burns, is currently progressing according to schedule. Sam has successfully guided the team through the initial planning phase and implementation stages over the past few months.
            Line 3: The project team has completed 60% of the planned deliverables, with key milestones being met on time. Sam Burns has implemented an effective communication strategy that keeps all stakeholders well-informed of project developments.
            Line 4: Recent challenges in resource allocation were efficiently addressed by Sam's strategic reorganization of team assignments. The project remains within budget constraints, thanks to careful monitoring and cost control measures put in place by the project leadership.
            Line 5: Sam Burns has scheduled the next major review meeting for early April 2025, where the team will present progress on the latest development phase. The project is expected to maintain its current momentum and meet the planned completion date.
            Line 6: Quality metrics continue to exceed expectations, with Sam's emphasis on thorough testing and validation procedures proving highly effective. The team morale remains high under Sam's supportive leadership style.
            Line 7: Action Items: All team leads are required to submit their progress reports by March 25, 2025. The resource allocation adjustment needs to be completed by March 30, 2025. Presentation materials for the April review meeting must be prepared by April 1, 2025. Individual team check-ins will be scheduled for the week of March 24. The project dashboard needs to be updated with the latest metrics by March 22, 2025. The Q2 budget forecast must be submitted by March 31, 2025."""
    # Base64 encode the content
    response = client.batch_put_document(applicationId=ApplicationId, indexId=IndexId, documents=[{'id':'Dummydoc','content':{'blob': CONTENT},'contentType':'PLAIN_TEXT'}])
  except Exception as e:
    print(f'An error occurred: {e}')
    raise e  # Re-raise the exception to trigger Lambda retry
  finally:
    # Send response back to CFN, otherwise the stack will wait until timeout
    # https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-responses.html
    print(f'response - {response}')
    return {
        'statusCode': 200,
        'body': f'SUCCESS - {response}'
    }
