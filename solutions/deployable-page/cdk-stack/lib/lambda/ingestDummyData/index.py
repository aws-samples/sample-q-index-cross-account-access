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
    CONTENT="""Project Status Update - Project X Date: March 19, 2025 Status: GREEN
            Project X, under the leadership of Sam Burns, is currently progressing according to schedule. Sam has successfully guided the team through the initial planning phase and implementation stages over the past few months.
            The project team has completed 60% of the planned deliverables, with key milestones being met on time. Sam Burns has implemented an effective communication strategy that keeps all stakeholders well-informed of project developments.
            Recent challenges in resource allocation were efficiently addressed by Sam's strategic reorganization of team assignments. The project remains within budget constraints, thanks to careful monitoring and cost control measures put in place by the project leadership.
            Sam Burns has scheduled the next major review meeting for early April 2025, where the team will present progress on the latest development phase. The project is expected to maintain its current momentum and meet the planned completion date.
            Quality metrics continue to exceed expectations, with Sam's emphasis on thorough testing and validation procedures proving highly effective. The team morale remains high under Sam's supportive leadership style.
            Action Items: All team leads are required to submit their progress reports by March 25, 2025. The resource allocation adjustment needs to be completed by March 30, 2025. Presentation materials for the April review meeting must be prepared by April 1, 2025. Individual team check-ins will be scheduled for the week of March 24. The project dashboard needs to be updated with the latest metrics by March 22, 2025. The Q2 budget forecast must be submitted by March 31, 2025."""
    # Base64 encode the content
    response1 = client.batch_put_document(applicationId=ApplicationId, indexId=IndexId, documents=[{'id':'Dummydoc','content':{'blob': CONTENT},'contentType':'PLAIN_TEXT'}])

    # Create the document content
    CONTENT2="""Sarah: Good morning David, thanks for joining the status update for Project X. How are things progressing?
            David: Morning Sarah. I'm happy to report that we're in good shape. All major milestones for Q1 are on track.
            Sarah: That's great to hear. Can you give me specifics on the development timeline?
            David: Sure. We've completed 85% of the planned features, testing is showing positive results, and we're actually slightly ahead of schedule. The team has been really efficient with the new automation tools we implemented.
            Sarah: Excellent. Any risks or concerns we should be aware of?
            David: Nothing significant at this time. We had some minor integration issues last week, but those have been resolved. Resource allocation is optimal, and team morale is high.
            Sarah: Perfect. So we're maintaining our green status for the project dashboard?
            David: Yes, absolutely. All KPIs are within acceptable ranges, and we're on track for the April 15th delivery date."""
    # Base64 encode the content
    response2 = client.batch_put_document(applicationId=ApplicationId, indexId=IndexId, documents=[{'id':'Dummydoc2','content':{'blob': CONTENT2},'contentType':'PLAIN_TEXT'}])

    # Create the email sample content
    CONTENT3="""Subject: Project X Status Update Follow-up From: David To: Sam Burns Date: March 20, 2025
              Hi Sam,
              I hope this email finds you well. I've just finished reviewing the latest status report for Project X, and I wanted to commend you on the excellent progress being made under your leadership.
              I'm particularly impressed with how you've handled the resource allocation challenges through strategic team reorganization. The 60% completion rate of deliverables and consistent achievement of key milestones is noteworthy.
              Could you please confirm the status of the following action items:
                  Team leads' progress reports (due March 25)
                  Resource allocation adjustment completion (due March 30)
                  Preparation of presentation materials for the April review meeting (due April 1)
                  Project dashboard update with latest metrics (due March 22)
                  Q2 budget forecast submission (due March 31)
              Also, please ensure that the individual team check-ins scheduled for next week are properly coordinated. The quality metrics are impressive, and I'd like to see this momentum maintained.
              Looking forward to the review meeting in early April. Please keep me informed of any significant developments or challenges that arise.
              Best regards, David"""
    # Base64 encode the content
    response3 = client.batch_put_document(applicationId=ApplicationId, indexId=IndexId, documents=[{'id':'Dummydoc3','content':{'blob': CONTENT3},'contentType':'PLAIN_TEXT'}])

  except Exception as e:
    print(f'An error occurred: {e}')
    raise e  # Re-raise the exception to trigger Lambda retry
  finally:
    # Send response back to CFN, otherwise the stack will wait until timeout
    # https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/crpg-ref-responses.html
    print(f'response - {response1} - {response2} - {response3}')
    return {
        'statusCode': 200,
        'body': f'SUCCESS - {response1} - {response2} - {response3'
    }
