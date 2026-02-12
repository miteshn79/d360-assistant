# Marketing Cloud Data Extension Setup for Journey Builder

## Data Extension: D360_Feedback_JB

Create this Data Extension in Marketing Cloud to use as a Journey Builder entry source.

### Steps to Create in Marketing Cloud

1. Go to **Email Studio** → **Subscribers** → **Data Extensions**
2. Click **Create**
3. Select **Standard Data Extension**
4. Configure as follows:

### Data Extension Properties

| Property | Value |
|----------|-------|
| **Name** | D360_Feedback_JB |
| **External Key** | D360_Feedback_JB |
| **Description** | Feedback entries from D360 Assistant app |
| **Is Sendable** | Yes |
| **Sendable Field** | ToEmailID |
| **Relationship to Subscribers** | Relates to Subscribers on Subscriber Key |

### Fields

| Field Name | Data Type | Length | Primary Key | Required | Default |
|------------|-----------|--------|-------------|----------|---------|
| ContactKey | Text | 50 | Yes | Yes | |
| ToEmailID | EmailAddress | 254 | No | Yes | |
| Subject | Text | 500 | No | No | |
| FeedbackType | Text | 50 | No | No | |
| Priority | Text | 20 | No | No | |
| PageName | Text | 200 | No | No | |
| Comment | Text | 4000 | No | No | |
| UserEmail | Text | 254 | No | No | |
| Timestamp | Text | 50 | No | No | |
| Rating | Text | 20 | No | No | |

### Journey Builder Setup

1. Go to **Journey Builder**
2. Click **Create New Journey**
3. Choose **Multi-Step Journey**
4. For Entry Source, select **Data Extension**
5. Select **D360_Feedback_JB** as the Data Extension
6. Set entry mode to **Add records to the journey when they are added to the data extension**

### Email Activity Configuration

In your email activity within the journey:
- Use these personalization strings:
  - `%%Subject%%` - Email subject line
  - `%%FeedbackType%%` - BUG, ENHANCEMENT, or FEEDBACK
  - `%%Priority%%` - HIGH, MEDIUM, or LOW
  - `%%PageName%%` - Page where feedback was submitted
  - `%%Comment%%` - The feedback content
  - `%%UserEmail%%` - Submitter's email (if provided)
  - `%%Timestamp%%` - When feedback was submitted
  - `%%Rating%%` - Positive, Negative, or N/A

### Environment Variables (Backend)

Set these on Heroku:
```bash
heroku config:set MC_DE_EXTERNAL_KEY="D360_Feedback_JB" -a work-with-d360-api
heroku config:set FEEDBACK_EMAIL_TO="mnarsana@salesforce.com" -a work-with-d360-api
```

### Testing

1. Submit feedback via the D360 Assistant app
2. Check the Data Extension in MC - a new row should appear
3. If Journey is active, an email should be triggered

### Sample Email HTML Template

```html
<!DOCTYPE html>
<html>
<head>
    <title>%%Subject%%</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
    <div style="padding: 20px; border-radius: 8px 8px 0 0; background: #dbeafe;">
        <h1 style="margin: 0; color: #1e40af; font-size: 24px;">
            %%FeedbackType%%
        </h1>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">
            Priority: <strong>%%Priority%%</strong>
        </p>
    </div>

    <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
                <td style="padding: 10px 0; color: #666; width: 120px; border-bottom: 1px solid #f0f0f0;">Page:</td>
                <td style="padding: 10px 0; font-weight: bold; border-bottom: 1px solid #f0f0f0;">%%PageName%%</td>
            </tr>
            <tr>
                <td style="padding: 10px 0; color: #666; border-bottom: 1px solid #f0f0f0;">Submitted:</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">%%Timestamp%%</td>
            </tr>
            <tr>
                <td style="padding: 10px 0; color: #666; border-bottom: 1px solid #f0f0f0;">User Email:</td>
                <td style="padding: 10px 0; border-bottom: 1px solid #f0f0f0;">%%UserEmail%%</td>
            </tr>
            <tr>
                <td style="padding: 10px 0; color: #666;">Rating:</td>
                <td style="padding: 10px 0;">%%Rating%%</td>
            </tr>
        </table>

        <div style="padding: 15px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #3b82f6;">
            <h3 style="margin: 0 0 10px 0; color: #374151; font-size: 16px;">
                Feedback Details
            </h3>
            <p style="margin: 0; white-space: pre-wrap; color: #1f2937; line-height: 1.6;">%%Comment%%</p>
        </div>

        <div style="margin-top: 20px; padding: 15px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
                <strong>Action Required:</strong> Please review and triage this feedback accordingly.
            </p>
        </div>
    </div>

    <div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 12px;">
        <p style="margin: 0;">D360 Assistant Feedback System</p>
        <p style="margin: 5px 0 0 0;">This is an automated notification.</p>
    </div>
</body>
</html>
```
