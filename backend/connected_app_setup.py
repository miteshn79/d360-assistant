"""Connected App setup via SOAP login and Metadata API deployment."""

import io
import os
import time
import zipfile
from dataclasses import dataclass
from typing import Optional
from xml.etree import ElementTree as ET

from simple_salesforce import Salesforce, SalesforceLogin
from simple_salesforce.exceptions import SalesforceAuthenticationFailed


@dataclass
class SoapLoginResult:
    """Result from SOAP API login."""
    session_id: str
    instance_url: str
    user_id: str
    org_id: str


@dataclass
class ConnectedAppConfig:
    """Configuration for the Connected App to create."""
    app_name: str = "DataCloudDebugger"
    label: str = "Data Cloud SE Debugger"
    contact_email: str = ""
    callback_url: str = "http://localhost:8000/oauth/callback"
    description: str = "Connected App for Data Cloud SE Ingestion & Debugger tool"

    # OAuth settings
    enable_pkce: bool = True
    consumer_secret_optional: bool = True

    # Scopes
    scopes: list = None

    # Policy
    ip_relaxation: str = "BYPASS"  # BYPASS, ENFORCE, RELAX
    refresh_token_policy: str = "infinite"

    # Pre-authorize for profile
    profile_name: str = "System Administrator"

    def __post_init__(self):
        if self.scopes is None:
            self.scopes = ["Api", "RefreshToken", "CDPIngest"]


@dataclass
class DeploymentResult:
    """Result from Connected App deployment."""
    success: bool
    deploy_id: str
    message: str
    app_name: str
    status: str = "Unknown"
    errors: list = None

    def __post_init__(self):
        if self.errors is None:
            self.errors = []


class ConnectedAppSetup:
    """Handles Connected App creation via SOAP login and Metadata API."""

    def __init__(self):
        self.sf: Optional[Salesforce] = None
        self.login_result: Optional[SoapLoginResult] = None

    def soap_login(
        self,
        username: str,
        password: str,
        security_token: str,
        domain: str = "login"
    ) -> SoapLoginResult:
        """Login to Salesforce using SOAP API.

        Args:
            username: Salesforce username
            password: Salesforce password
            security_token: Security token from user settings
            domain: Login domain ('login' for production, 'test' for sandbox,
                    or full My Domain like 'mycompany.my')

        Returns:
            SoapLoginResult with session info

        Raises:
            SalesforceAuthenticationFailed: If login fails
        """
        # Handle My Domain URLs
        if domain.startswith("https://"):
            # Extract domain from full URL
            domain = domain.replace("https://", "").replace("http://", "")
            if domain.endswith(".salesforce.com"):
                domain = domain.replace(".salesforce.com", "")
            if domain.endswith(".my"):
                domain = domain.replace(".my", ".my")

        # Perform SOAP login
        session_id, instance = SalesforceLogin(
            username=username,
            password=password,
            security_token=security_token,
            domain=domain
        )

        # Create Salesforce client
        self.sf = Salesforce(
            instance_url=f"https://{instance}",
            session_id=session_id
        )

        # Get user info
        user_info = self.sf.query(
            "SELECT Id, Username, Profile.Name FROM User WHERE Username = '{}'".format(
                username.replace("'", "\\'")
            )
        )

        user_id = ""
        if user_info.get("records"):
            user_id = user_info["records"][0]["Id"]

        # Get org info
        org_info = self.sf.query("SELECT Id, Name FROM Organization LIMIT 1")
        org_id = ""
        if org_info.get("records"):
            org_id = org_info["records"][0]["Id"]

        self.login_result = SoapLoginResult(
            session_id=session_id,
            instance_url=f"https://{instance}",
            user_id=user_id,
            org_id=org_id
        )

        return self.login_result

    def generate_connected_app_xml(self, config: ConnectedAppConfig) -> str:
        """Generate Connected App metadata XML.

        Args:
            config: Connected App configuration

        Returns:
            XML string for the Connected App metadata
        """
        # Build scopes XML
        scopes_xml = "\n        ".join([f"<scopes>{scope}</scopes>" for scope in config.scopes])

        xml_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<ConnectedApp xmlns="http://soap.sforce.com/2006/04/metadata">
    <contactEmail>{config.contact_email}</contactEmail>
    <description>{config.description}</description>
    <label>{config.label}</label>
    <oauthConfig>
        <callbackUrl>{config.callback_url}</callbackUrl>
        <isAdminApproved>true</isAdminApproved>
        <isClientCredentialEnabled>false</isClientCredentialEnabled>
        <isCodeCredentialEnabled>false</isCodeCredentialEnabled>
        <isCodeCredentialPostOnly>false</isCodeCredentialPostOnly>
        <isConsumerSecretOptional>{str(config.consumer_secret_optional).lower()}</isConsumerSecretOptional>
        <isIntrospectAllTokens>false</isIntrospectAllTokens>
        <isNamedUserJwtEnabled>false</isNamedUserJwtEnabled>
        <isPkceRequired>{str(config.enable_pkce).lower()}</isPkceRequired>
        <isRefreshTokenRotationEnabled>false</isRefreshTokenRotationEnabled>
        <isSecretRequiredForRefreshToken>false</isSecretRequiredForRefreshToken>
        <isSecretRequiredForTokenExchange>false</isSecretRequiredForTokenExchange>
        <isTokenExchangeEnabled>false</isTokenExchangeEnabled>
        {scopes_xml}
    </oauthConfig>
    <oauthPolicy>
        <ipRelaxation>{config.ip_relaxation}</ipRelaxation>
        <isTokenExchangeFlowEnabled>false</isTokenExchangeFlowEnabled>
        <refreshTokenPolicy>{config.refresh_token_policy}</refreshTokenPolicy>
    </oauthPolicy>
    <profileName>{config.profile_name}</profileName>
</ConnectedApp>'''

        return xml_content

    def generate_package_xml(self, app_name: str, api_version: str = "62.0") -> str:
        """Generate package.xml for deployment.

        Args:
            app_name: Name of the Connected App
            api_version: Salesforce API version

        Returns:
            XML string for package.xml
        """
        return f'''<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>{app_name}</members>
        <name>ConnectedApp</name>
    </types>
    <version>{api_version}</version>
</Package>'''

    def create_deployment_zip(self, config: ConnectedAppConfig) -> bytes:
        """Create a ZIP file for Metadata API deployment.

        Args:
            config: Connected App configuration

        Returns:
            ZIP file contents as bytes
        """
        # Create in-memory ZIP file
        zip_buffer = io.BytesIO()

        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            # Add package.xml
            package_xml = self.generate_package_xml(config.app_name)
            zf.writestr('package.xml', package_xml)

            # Add Connected App metadata
            app_xml = self.generate_connected_app_xml(config)
            zf.writestr(
                f'connectedApps/{config.app_name}.connectedApp-meta.xml',
                app_xml
            )

        zip_buffer.seek(0)
        return zip_buffer.getvalue()

    def deploy_connected_app(
        self,
        config: ConnectedAppConfig,
        timeout: int = 120
    ) -> DeploymentResult:
        """Deploy Connected App via Metadata API.

        Args:
            config: Connected App configuration
            timeout: Maximum time to wait for deployment (seconds)

        Returns:
            DeploymentResult with deployment status

        Raises:
            ValueError: If not logged in
        """
        if not self.sf:
            raise ValueError("Not logged in. Call soap_login() first.")

        # Create deployment ZIP
        zip_data = self.create_deployment_zip(config)

        # Save to temp file (simple-salesforce requires a file path)
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as tmp:
            tmp.write(zip_data)
            tmp_path = tmp.name

        try:
            # Deploy using Metadata API
            deploy_result = self.sf.deploy(tmp_path, sandbox=False, checkOnly=False)

            deploy_id = deploy_result.get('asyncId', deploy_result.get('id', 'unknown'))

            # Poll for completion
            start_time = time.time()
            while time.time() - start_time < timeout:
                status = self.sf.checkDeployStatus(deploy_id, True)

                state = status.get('status', status.get('state', 'Unknown'))

                if state in ('Succeeded', 'Completed'):
                    return DeploymentResult(
                        success=True,
                        deploy_id=deploy_id,
                        message=f"Connected App '{config.label}' deployed successfully!",
                        app_name=config.app_name,
                        status=state
                    )
                elif state in ('Failed', 'Canceled', 'Error'):
                    errors = []
                    # Try to extract error details
                    details = status.get('details', {})
                    if isinstance(details, dict):
                        component_failures = details.get('componentFailures', [])
                        if isinstance(component_failures, list):
                            for failure in component_failures:
                                if isinstance(failure, dict):
                                    errors.append(failure.get('problem', str(failure)))
                        elif isinstance(component_failures, dict):
                            errors.append(component_failures.get('problem', str(component_failures)))

                    return DeploymentResult(
                        success=False,
                        deploy_id=deploy_id,
                        message=f"Deployment failed: {state}",
                        app_name=config.app_name,
                        status=state,
                        errors=errors if errors else [str(status)]
                    )

                # Still in progress
                time.sleep(2)

            # Timeout
            return DeploymentResult(
                success=False,
                deploy_id=deploy_id,
                message=f"Deployment timed out after {timeout} seconds",
                app_name=config.app_name,
                status="Timeout"
            )

        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass

    def get_app_manager_url(self, config: ConnectedAppConfig) -> str:
        """Get URL to the App Manager page for retrieving Consumer Key.

        Args:
            config: Connected App configuration

        Returns:
            URL to App Manager
        """
        if not self.login_result:
            return ""

        base_url = self.login_result.instance_url
        # URL to App Manager with search filter
        return f"{base_url}/lightning/setup/NavigationMenus/home"

    def get_connected_app_setup_url(self, config: ConnectedAppConfig) -> str:
        """Get URL to the Connected App setup page.

        Args:
            config: Connected App configuration

        Returns:
            URL to Connected App in Setup
        """
        if not self.login_result:
            return ""

        base_url = self.login_result.instance_url
        # Direct URL to Connected Apps list
        return f"{base_url}/lightning/setup/ConnectedApplication/home"


def check_existing_connected_app(sf: Salesforce, app_name: str) -> Optional[dict]:
    """Check if a Connected App with the given name already exists.

    Args:
        sf: Salesforce client
        app_name: Name of the Connected App

    Returns:
        Connected App info if found, None otherwise
    """
    try:
        # Query ConnectedApplication object
        result = sf.query(
            f"SELECT Id, Name, MasterLabel FROM ConnectedApplication WHERE Name = '{app_name}'"
        )
        if result.get("records"):
            return result["records"][0]
    except Exception:
        pass
    return None


def get_consumer_key_instructions(instance_url: str, app_label: str) -> str:
    """Get instructions for retrieving the Consumer Key.

    Args:
        instance_url: Salesforce instance URL
        app_label: Label of the Connected App

    Returns:
        Formatted instructions string
    """
    return f"""
## How to Get the Consumer Key

1. **Open Salesforce Setup**
   Go to: {instance_url}/lightning/setup/SetupOneHome/home

2. **Navigate to App Manager**
   - In Quick Find, search for "App Manager"
   - Or go to: Setup → Apps → App Manager

3. **Find Your Connected App**
   - Look for "{app_label}" in the list
   - Click the dropdown arrow (▼) on the right
   - Click "View"

4. **Get Consumer Details**
   - Scroll to "API (Enable OAuth Settings)"
   - Click "Manage Consumer Details"
   - You may need to verify your identity (MFA/email code)

5. **Copy the Consumer Key**
   - Copy the "Consumer Key" value
   - Paste it back into this application

**Note:** The Consumer Secret is not needed if PKCE is enabled (which it is by default).
"""
