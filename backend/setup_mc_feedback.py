"""
Setup Marketing Cloud for D360 Feedback Notifications

This script creates:
1. A Data Extension for feedback attributes
2. An Email template with personalization
3. A Triggered Send Definition

Run with: python setup_mc_feedback.py
"""

import httpx
import os
import time
import uuid

# Marketing Cloud credentials
MC_CLIENT_ID = os.getenv("MC_CLIENT_ID", "0here0t71j1w7eos0agqhs3p")
MC_CLIENT_SECRET = os.getenv("MC_CLIENT_SECRET", "1nUoAEBDNk89jEEymHQqI4UX")
MC_AUTH_BASE_URI = os.getenv("MC_AUTH_BASE_URI", "https://mclxn4kxhgprzmp4xdkhx830b2n4.auth.marketingcloudapis.com")
MC_REST_BASE_URI = os.getenv("MC_REST_BASE_URI", "https://mclxn4kxhgprzmp4xdkhx830b2n4.rest.marketingcloudapis.com")
MC_SOAP_BASE_URI = os.getenv("MC_SOAP_BASE_URI", "https://mclxn4kxhgprzmp4xdkhx830b2n4.soap.marketingcloudapis.com")

FEEDBACK_EMAIL_TO = "mnarsana@salesforce.com"


def get_access_token():
    """Get OAuth2 access token from Marketing Cloud."""
    print("Getting access token...")
    response = httpx.post(
        f"{MC_AUTH_BASE_URI}/v2/token",
        json={
            "grant_type": "client_credentials",
            "client_id": MC_CLIENT_ID,
            "client_secret": MC_CLIENT_SECRET,
        },
        timeout=30.0,
    )
    if response.status_code == 200:
        data = response.json()
        print(f"✓ Got access token (expires in {data.get('expires_in')}s)")
        return data["access_token"]
    else:
        print(f"✗ Auth failed: {response.status_code} - {response.text}")
        return None


def get_data_extension_folder_id(token):
    """Get the root Data Extensions folder ID."""
    print("  Getting Data Extension folder ID...")

    # Try to get categories/folders
    response = httpx.get(
        f"{MC_REST_BASE_URI}/data/v1/categories",
        headers={
            "Authorization": f"Bearer {token}",
        },
        timeout=30.0,
    )

    if response.status_code == 200:
        data = response.json()
        items = data.get("items", [])
        # Look for "Data Extensions" or root folder
        for item in items:
            name = item.get("name", "").lower()
            if "data extension" in name or item.get("parentId") == 0:
                print(f"  Found folder: {item.get('name')} (ID: {item.get('id')})")
                return item.get("id")
        # Return first available folder if no match
        if items:
            print(f"  Using folder: {items[0].get('name')} (ID: {items[0].get('id')})")
            return items[0].get("id")
    else:
        print(f"  Could not get folders: {response.status_code}")

    return None


def create_data_extension(token):
    """Create a Data Extension for feedback attributes."""
    print("\nCreating Data Extension...")

    # Get folder ID
    category_id = get_data_extension_folder_id(token)

    # Data Extension definition - using correct REST API endpoint
    # Reference: https://medium.com/@marketingcloudtips/creating-a-new-data-extension-using-the-rest-api-e83c38213127
    de_payload = {
        "name": "D360_Feedback",
        "key": "D360_Feedback",
        "description": "Stores feedback from D360 Assistant app",
        "isSendable": True,
        "sendableCustomObjectField": "EmailAddress",
        "sendableSubscriberField": "_SubscriberKey",
        "fields": [
            {"name": "EmailAddress", "type": "EmailAddress", "isPrimaryKey": True, "isNullable": False, "ordinal": 0},
            {"name": "SubscriberKey", "type": "Text", "length": 254, "isNullable": False, "ordinal": 1},
            {"name": "Subject", "type": "Text", "length": 500, "isNullable": True, "ordinal": 2},
            {"name": "FeedbackType", "type": "Text", "length": 50, "isNullable": True, "ordinal": 3},
            {"name": "Priority", "type": "Text", "length": 20, "isNullable": True, "ordinal": 4},
            {"name": "PageName", "type": "Text", "length": 200, "isNullable": True, "ordinal": 5},
            {"name": "Comment", "type": "Text", "length": 4000, "isNullable": True, "ordinal": 6},
            {"name": "UserEmail", "type": "Text", "length": 254, "isNullable": True, "ordinal": 7},
            {"name": "Timestamp", "type": "Text", "length": 50, "isNullable": True, "ordinal": 8},
            {"name": "Rating", "type": "Text", "length": 20, "isNullable": True, "ordinal": 9},
        ]
    }

    # Add categoryId if found
    if category_id:
        de_payload["categoryId"] = category_id

    # Correct endpoint: /data/v1/customobjects (not /data/v1/customobjectdata)
    response = httpx.post(
        f"{MC_REST_BASE_URI}/data/v1/customobjects",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=de_payload,
        timeout=30.0,
    )

    if response.status_code in (200, 201):
        data = response.json()
        print(f"✓ Data Extension created successfully (ID: {data.get('id', 'N/A')})")
        return True
    elif response.status_code == 409:
        print("✓ Data Extension already exists")
        return True
    else:
        print(f"✗ Failed to create DE: {response.status_code} - {response.text}")
        # Try alternative approach: check if DE exists
        print("  Checking if Data Extension already exists...")
        check_response = httpx.get(
            f"{MC_REST_BASE_URI}/data/v1/customobjects/key:D360_Feedback",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )
        if check_response.status_code == 200:
            print("✓ Data Extension already exists (verified)")
            return True
        return False


def create_email_template(token):
    """Create an email template in Content Builder."""
    print("\nCreating Email Template...")

    html_content = """<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>D360 Feedback Notification</title>
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">

    <!-- Header based on feedback type -->
    <div style="padding: 20px; border-radius: 8px 8px 0 0; background: #dbeafe;">
        <h1 style="margin: 0; color: #1e40af; font-size: 24px;">
            %%FeedbackType%%
        </h1>
        <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">
            Priority: <strong>%%Priority%%</strong>
        </p>
    </div>

    <!-- Content -->
    <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">

        <!-- Details Table -->
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

        <!-- Feedback Content -->
        <div style="padding: 15px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #3b82f6;">
            <h3 style="margin: 0 0 10px 0; color: #374151; font-size: 16px;">
                Feedback Details
            </h3>
            <p style="margin: 0; white-space: pre-wrap; color: #1f2937; line-height: 1.6;">%%Comment%%</p>
        </div>

        <!-- Action Note for Bugs -->
        <div style="margin-top: 20px; padding: 15px; background: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 14px;">
                <strong>Action Required:</strong> Please review and triage this feedback accordingly.
            </p>
        </div>
    </div>

    <!-- Footer -->
    <div style="padding: 20px; text-align: center; color: #9ca3af; font-size: 12px;">
        <p style="margin: 0;">D360 Assistant Feedback System</p>
        <p style="margin: 5px 0 0 0;">This is an automated notification.</p>
    </div>

</body>
</html>"""

    text_content = """D360 FEEDBACK NOTIFICATION
==========================

Type: %%FeedbackType%%
Priority: %%Priority%%

Page: %%PageName%%
Submitted: %%Timestamp%%
User Email: %%UserEmail%%
Rating: %%Rating%%

FEEDBACK:
%%Comment%%

---
D360 Assistant Feedback System"""

    # Content Builder asset payload structure
    # Reference: https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/content-api.html
    email_payload = {
        "name": "D360 Feedback Notification",
        "customerKey": "D360_Feedback_Email",
        "description": "Email template for D360 Assistant feedback notifications",
        "assetType": {
            "name": "htmlemail",
            "id": 208
        },
        "views": {
            "html": {
                "content": html_content
            },
            "text": {
                "content": text_content
            },
            "subjectline": {
                "content": "%%Subject%%"
            }
        }
    }

    response = httpx.post(
        f"{MC_REST_BASE_URI}/asset/v1/content/assets",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=email_payload,
        timeout=30.0,
    )

    if response.status_code in (200, 201):
        data = response.json()
        print(f"✓ Email template created (ID: {data.get('id')})")
        return data.get("id")
    elif response.status_code == 409:
        print("✓ Email template already exists, fetching ID...")
        return get_existing_email_id(token)
    else:
        print(f"✗ Failed to create email: {response.status_code}")
        print(f"  Response: {response.text[:500]}...")
        # Try searching for existing asset
        existing_id = get_existing_email_id(token)
        if existing_id:
            print(f"✓ Found existing email template (ID: {existing_id})")
            return existing_id
        return None


def get_existing_email_id(token):
    """Search for existing email template by customer key."""
    search_response = httpx.post(
        f"{MC_REST_BASE_URI}/asset/v1/content/assets/query",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            "query": {
                "property": "customerKey",
                "simpleOperator": "equals",
                "value": "D360_Feedback_Email"
            }
        },
        timeout=30.0,
    )
    if search_response.status_code == 200:
        items = search_response.json().get("items", [])
        if items:
            return items[0].get("id")
    return None


def validate_and_activate_definition(token, definition_key):
    """Check and activate a Triggered Send Definition."""
    print(f"\nValidating and activating definition: {definition_key}...")

    # Get current status and full details
    response = httpx.get(
        f"{MC_REST_BASE_URI}/messaging/v1/email/definitions/{definition_key}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )

    if response.status_code == 200:
        data = response.json()
        status = data.get("status")
        content = data.get("content", {})
        print(f"  Current status: {status}")
        print(f"  Content customerKey: {content.get('customerKey', 'N/A')}")

        if status == "Active":
            print("✓ Definition is already active")
            return True

        # If the content customerKey is wrong, we need to update it
        if content.get("customerKey") != "D360_Feedback_Email":
            print("  Content customerKey mismatch, updating...")
            update_response = httpx.patch(
                f"{MC_REST_BASE_URI}/messaging/v1/email/definitions/{definition_key}",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "content": {
                        "customerKey": "D360_Feedback_Email"
                    }
                },
                timeout=30.0,
            )
            if update_response.status_code in (200, 204):
                print("  ✓ Content updated")
            else:
                print(f"  ✗ Content update failed: {update_response.status_code}")
                print(f"    {update_response.text[:200]}...")

        # Try to activate by PATCH
        print("  Attempting to activate...")
        patch_response = httpx.patch(
            f"{MC_REST_BASE_URI}/messaging/v1/email/definitions/{definition_key}",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={"status": "Active"},
            timeout=30.0,
        )

        if patch_response.status_code in (200, 204):
            print("✓ Definition activated successfully")
            return True
        else:
            print(f"✗ Failed to activate: {patch_response.status_code}")
            error_data = patch_response.json() if patch_response.text else {}
            print(f"  Error: {error_data.get('message', patch_response.text[:300])}")

            # The email might need a "from" address or sender profile
            print("\n  TIP: The email template may need:")
            print("    - A valid sender profile in MC")
            print("    - The template may need to be approved/published")
            print("    - Check if the email has all required fields (From, Subject)")
            return False
    else:
        print(f"✗ Could not get definition: {response.status_code}")
        return False


def check_email_asset_details(token, email_id):
    """Get full details of the email asset to diagnose issues."""
    print(f"\nChecking email asset (ID: {email_id})...")

    response = httpx.get(
        f"{MC_REST_BASE_URI}/asset/v1/content/assets/{email_id}",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )

    if response.status_code == 200:
        data = response.json()
        print(f"  Name: {data.get('name')}")
        print(f"  Customer Key: {data.get('customerKey')}")
        print(f"  Status: {data.get('status', {}).get('name', 'N/A')}")
        print(f"  Asset Type: {data.get('assetType', {}).get('name', 'N/A')}")
        views = data.get("views", {})
        print(f"  Has HTML: {'html' in views}")
        print(f"  Has Subject: {'subjectline' in views}")
        return data
    else:
        print(f"  ✗ Could not get asset: {response.status_code}")
        return None


def create_triggered_send_definition(token, email_asset_id):
    """Create a Triggered Send Definition using Transactional Messaging API."""
    print("\nCreating Triggered Send Definition...")

    # Get existing definition to update it, or create new
    existing_response = httpx.get(
        f"{MC_REST_BASE_URI}/messaging/v1/email/definitions/D360_Feedback_TSD",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )

    if existing_response.status_code == 200:
        print("  Definition already exists, checking if we can update it...")
        existing = existing_response.json()

        # If it exists but is not active, try deleting and recreating
        if existing.get("status") != "Active":
            print("  Attempting to delete and recreate with proper configuration...")
            delete_response = httpx.delete(
                f"{MC_REST_BASE_URI}/messaging/v1/email/definitions/D360_Feedback_TSD",
                headers={"Authorization": f"Bearer {token}"},
                timeout=30.0,
            )
            if delete_response.status_code in (200, 204):
                print("  ✓ Old definition deleted")
            else:
                print(f"  Could not delete (status: {delete_response.status_code})")

    # Transactional Messaging API payload with sender info
    # Reference: https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/transactional-messaging-api.html
    tsd_payload = {
        "definitionKey": "D360_Feedback_TSD",
        "name": "D360 Feedback Notification",
        "description": "Triggered send for D360 Assistant feedback",
        "classification": "Default Transactional",
        "status": "Active",
        "content": {
            "customerKey": "D360_Feedback_Email"
        },
        "subscriptions": {
            "list": "All Subscribers"
        },
        "options": {
            "trackLinks": True
        }
    }

    response = httpx.post(
        f"{MC_REST_BASE_URI}/messaging/v1/email/definitions",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=tsd_payload,
        timeout=30.0,
    )

    if response.status_code in (200, 201):
        data = response.json()
        print(f"✓ Triggered Send Definition created")
        print(f"  Definition Key: {data.get('definitionKey')}")
        return data.get("definitionKey")
    elif response.status_code == 409:
        print("✓ Triggered Send Definition already exists")
        return "D360_Feedback_TSD"
    else:
        print(f"✗ Failed to create TSD: {response.status_code}")
        print(f"  Response: {response.text[:500]}...")
        # Check if it exists already
        check_response = httpx.get(
            f"{MC_REST_BASE_URI}/messaging/v1/email/definitions/D360_Feedback_TSD",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )
        if check_response.status_code == 200:
            print("✓ Triggered Send Definition already exists (verified)")
            return "D360_Feedback_TSD"
        # List all definitions to see what's available
        list_response = httpx.get(
            f"{MC_REST_BASE_URI}/messaging/v1/email/definitions",
            headers={"Authorization": f"Bearer {token}"},
            timeout=30.0,
        )
        if list_response.status_code == 200:
            definitions = list_response.json().get("definitions", [])
            print(f"  Available definitions: {len(definitions)}")
            for d in definitions[:5]:
                print(f"    - {d.get('name')} ({d.get('definitionKey')})")
        return None


def send_test_email(token, definition_key):
    """Send a test email to verify setup using Transactional Messaging API."""
    print("\nSending test email...")

    # Generate a unique message key
    message_key = str(uuid.uuid4())

    # Transactional send payload
    # Reference: https://developer.salesforce.com/docs/marketing/marketing-cloud/guide/transactional-messaging-api.html
    test_payload = {
        "definitionKey": definition_key,
        "recipient": {
            "contactKey": FEEDBACK_EMAIL_TO,
            "to": FEEDBACK_EMAIL_TO,
            "attributes": {
                "Subject": "TEST - D360 Feedback System Working!",
                "FeedbackType": "TEST",
                "Priority": "LOW",
                "PageName": "Setup Script",
                "Comment": "This is a test email to verify the D360 Feedback notification system is working correctly.\n\nIf you received this email, the Marketing Cloud integration is configured properly!",
                "UserEmail": "setup-script@d360-assistant.com",
                "Timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "Rating": "N/A"
            }
        }
    }

    # POST to /messaging/v1/email/messages/{messageKey}
    response = httpx.post(
        f"{MC_REST_BASE_URI}/messaging/v1/email/messages/{message_key}",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=test_payload,
        timeout=30.0,
    )

    if response.status_code in (200, 202):
        data = response.json()
        print(f"✓ Test email sent!")
        print(f"  Message Key: {message_key}")
        print(f"  Request ID: {data.get('requestId', 'N/A')}")
        return True
    else:
        print(f"✗ Failed to send test: {response.status_code}")
        print(f"  Response: {response.text[:500]}...")
        return False


def list_existing_definitions(token):
    """List all existing email definitions to find usable ones."""
    print("\nListing existing email definitions...")

    response = httpx.get(
        f"{MC_REST_BASE_URI}/messaging/v1/email/definitions",
        headers={"Authorization": f"Bearer {token}"},
        timeout=30.0,
    )

    if response.status_code == 200:
        data = response.json()
        definitions = data.get("definitions", [])
        print(f"  Found {len(definitions)} definitions:")
        for d in definitions:
            status = d.get("status", "Unknown")
            active = "✓" if status == "Active" else "○"
            print(f"    {active} {d.get('name')} (key: {d.get('definitionKey')}, status: {status})")
        return definitions
    else:
        print(f"  ✗ Could not list definitions: {response.status_code}")
        return []


def main():
    print("=" * 60)
    print("D360 MARKETING CLOUD FEEDBACK SETUP")
    print("=" * 60)

    # Step 1: Get access token
    token = get_access_token()
    if not token:
        print("\n✗ Setup failed: Could not authenticate")
        return

    # Step 2: List existing definitions to see what's available
    definitions = list_existing_definitions(token)

    # Find an active definition or the one we created
    active_def = None
    our_def = None
    for d in definitions:
        if d.get("status") == "Active":
            active_def = d.get("definitionKey")
        if d.get("definitionKey") == "D360_Feedback_TSD":
            our_def = d

    if active_def:
        print(f"\n  Found active definition: {active_def}")
        tsd_key = active_def
    else:
        # Step 3: Create Data Extension (optional, skip if issues)
        print("\nSkipping Data Extension creation (requires manual setup in MC)")

        # Step 4: Create Email Template
        email_id = create_email_template(token)

        # Step 5: Check email asset details
        if email_id:
            check_email_asset_details(token, email_id)

        # Step 6: Create Triggered Send Definition
        if email_id:
            tsd_key = create_triggered_send_definition(token, email_id)
        else:
            tsd_key = None

        # Step 7: Try to activate the definition
        if tsd_key:
            validate_and_activate_definition(token, tsd_key)

    # Step 8: Send test email if we have an active definition
    if active_def:
        print(f"\n  Using active definition: {active_def}")
        send_test_email(token, active_def)
    elif tsd_key:
        send_test_email(token, tsd_key)

    print("\n" + "=" * 60)
    print("SETUP COMPLETE")
    print("=" * 60)

    if active_def:
        print(f"""
✓ Found active Triggered Send Definition: {active_def}

Next steps:
1. Check your email ({FEEDBACK_EMAIL_TO}) for the test message
2. Update Heroku config:
   heroku config:set MC_TRIGGERED_SEND_ID="{active_def}" -a work-with-d360-api

3. Test the feedback button on the live app
""")
    elif tsd_key:
        print(f"""
NOTE: The Triggered Send Definition was created but is not yet active.

═══════════════════════════════════════════════════════════════
MANUAL SETUP REQUIRED IN MARKETING CLOUD
═══════════════════════════════════════════════════════════════

To activate the Triggered Send Definition, you need to complete
setup in Marketing Cloud UI:

1. Go to Marketing Cloud → Email Studio → Transactional Messaging
2. Find "D360 Feedback Notification" or create new:
   - Click "Create Definition"
   - Name: D360 Feedback Notification
   - Definition Key: D360_Feedback_TSD
   - Select email: D360_Feedback_Email (or create new with HTML)
   - Set "From" address/Sender Profile
   - Set Send Classification: Default Transactional
   - Click "Activate"

3. Update Heroku config with the definition key:
   heroku config:set MC_TRIGGERED_SEND_ID="D360_Feedback_TSD" -a work-with-d360-api

4. Test the feedback button on the live app

ALTERNATIVE: Use a different email service like SendGrid which
has simpler API setup requirements.
""")
    else:
        print("""
═══════════════════════════════════════════════════════════════
SETUP INCOMPLETE - MANUAL CONFIGURATION NEEDED
═══════════════════════════════════════════════════════════════

The Marketing Cloud Transactional Messaging API requires:
1. A verified sender profile
2. A properly configured email template
3. An activated Triggered Send Definition

Please set these up manually in Marketing Cloud UI or consider
using an alternative email service like SendGrid.
""")


if __name__ == "__main__":
    main()
