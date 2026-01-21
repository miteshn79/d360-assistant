"""Salesforce OAuth 2.0 Authorization Code + PKCE flow helpers."""

import base64
import hashlib
import secrets
from typing import Optional
from urllib.parse import urlencode, urlparse

import httpx

from models import OAuthConfig, OAuthTokens, UserIdentity


def _ensure_https(url: Optional[str]) -> str:
    """Ensure URL has https:// protocol.

    Args:
        url: URL string that may or may not have protocol

    Returns:
        URL with https:// protocol, or empty string if url is None/empty
    """
    if not url:
        return ""
    url = url.strip()
    if not url:
        return ""
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return f"https://{url}"


class PKCEHelper:
    """Helper class for PKCE (Proof Key for Code Exchange) flow."""

    @staticmethod
    def generate_code_verifier(length: int = 128) -> str:
        """Generate a cryptographically random code verifier.

        Args:
            length: Length of the verifier (43-128 characters)

        Returns:
            URL-safe base64-encoded random string
        """
        # Generate random bytes and encode to URL-safe base64
        random_bytes = secrets.token_bytes(96)
        verifier = base64.urlsafe_b64encode(random_bytes).decode('utf-8')
        # Remove padding and truncate to desired length
        verifier = verifier.replace('=', '')[:length]
        return verifier

    @staticmethod
    def generate_code_challenge(code_verifier: str) -> str:
        """Generate code challenge from code verifier using S256 method.

        Args:
            code_verifier: The code verifier string

        Returns:
            Base64 URL-encoded SHA256 hash of the verifier
        """
        # SHA256 hash of the verifier
        digest = hashlib.sha256(code_verifier.encode('utf-8')).digest()
        # Base64 URL encode (no padding)
        challenge = base64.urlsafe_b64encode(digest).decode('utf-8').replace('=', '')
        return challenge

    @staticmethod
    def generate_state() -> str:
        """Generate a random state parameter for CSRF protection.

        Returns:
            URL-safe random string
        """
        return secrets.token_urlsafe(32)


class SalesforceOAuthClient:
    """Client for Salesforce OAuth 2.0 + PKCE authentication."""

    def __init__(self, config: OAuthConfig):
        """Initialize the OAuth client.

        Args:
            config: OAuth configuration
        """
        self.config = config
        self._http_client = httpx.AsyncClient(timeout=30.0)

    async def close(self):
        """Close the HTTP client."""
        await self._http_client.aclose()

    def get_authorization_url(
        self,
        code_challenge: str,
        state: str,
        scope: str = "api refresh_token cdp_ingest_api cdp_profile_api cdp_query_api"
    ) -> str:
        """Build the authorization URL for the OAuth flow.

        Args:
            code_challenge: PKCE code challenge
            state: CSRF protection state
            scope: OAuth scopes to request

        Returns:
            Full authorization URL to redirect user to
        """
        # Normalize the login URL
        base_url = _ensure_https(self.config.login_url).rstrip('/')

        params = {
            "response_type": "code",
            "client_id": self.config.client_id,
            "redirect_uri": self.config.redirect_uri,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
            "state": state,
            "scope": scope,
        }

        auth_endpoint = f"{base_url}/services/oauth2/authorize"
        return f"{auth_endpoint}?{urlencode(params)}"

    async def exchange_code_for_tokens(
        self,
        authorization_code: str,
        code_verifier: str
    ) -> OAuthTokens:
        """Exchange authorization code for access tokens.

        Args:
            authorization_code: The authorization code from callback
            code_verifier: The original PKCE code verifier

        Returns:
            OAuth tokens

        Raises:
            httpx.HTTPStatusError: If token exchange fails
            ValueError: If response is invalid
        """
        base_url = _ensure_https(self.config.login_url).rstrip('/')
        token_endpoint = f"{base_url}/services/oauth2/token"

        data = {
            "grant_type": "authorization_code",
            "code": authorization_code,
            "client_id": self.config.client_id,
            "redirect_uri": self.config.redirect_uri,
            "code_verifier": code_verifier,
        }

        response = await self._http_client.post(
            token_endpoint,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )

        # Get response body for error details before raising
        try:
            token_data = response.json()
        except Exception:
            token_data = {"raw_response": response.text}

        if response.status_code != 200:
            error_msg = token_data.get("error", "Unknown error")
            error_desc = token_data.get("error_description", str(token_data))
            raise ValueError(f"Token exchange failed: {error_msg} - {error_desc}")

        return OAuthTokens(
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token"),
            instance_url=token_data["instance_url"],
            token_type=token_data.get("token_type", "Bearer"),
            issued_at=token_data.get("issued_at"),
            id_url=token_data.get("id"),
        )

    async def refresh_access_token(
        self,
        refresh_token: str
    ) -> OAuthTokens:
        """Refresh the access token using a refresh token.

        Args:
            refresh_token: The refresh token

        Returns:
            New OAuth tokens

        Raises:
            httpx.HTTPStatusError: If refresh fails
        """
        base_url = _ensure_https(self.config.login_url).rstrip('/')
        token_endpoint = f"{base_url}/services/oauth2/token"

        data = {
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": self.config.client_id,
        }

        response = await self._http_client.post(
            token_endpoint,
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"}
        )
        response.raise_for_status()

        token_data = response.json()

        return OAuthTokens(
            access_token=token_data["access_token"],
            refresh_token=refresh_token,  # Refresh token may not be returned
            instance_url=token_data["instance_url"],
            token_type=token_data.get("token_type", "Bearer"),
            issued_at=token_data.get("issued_at"),
            id_url=token_data.get("id"),
        )

    async def get_user_identity(
        self,
        tokens: OAuthTokens
    ) -> UserIdentity:
        """Fetch user identity information from Salesforce.

        Args:
            tokens: OAuth tokens with access token

        Returns:
            User identity information

        Raises:
            httpx.HTTPStatusError: If identity request fails
        """
        if not tokens.id_url:
            # Construct identity URL from instance URL
            instance_url = _ensure_https(tokens.instance_url).rstrip('/')
            identity_url = f"{instance_url}/services/oauth2/userinfo"
        else:
            identity_url = _ensure_https(tokens.id_url)

        response = await self._http_client.get(
            identity_url,
            headers={"Authorization": f"{tokens.token_type} {tokens.access_token}"}
        )
        response.raise_for_status()

        identity_data = response.json()

        return UserIdentity(
            user_id=identity_data.get("user_id", identity_data.get("sub", "")),
            username=identity_data.get("preferred_username", identity_data.get("username", "")),
            display_name=identity_data.get("name"),
            organization_id=identity_data.get("organization_id", identity_data.get("custom_attributes", {}).get("org_id", "")),
            email=identity_data.get("email"),
        )

    async def test_token(self, tokens: OAuthTokens) -> tuple[bool, str]:
        """Test if the access token is valid by calling the identity endpoint.

        Args:
            tokens: OAuth tokens to test

        Returns:
            Tuple of (success: bool, message: str)
        """
        try:
            identity = await self.get_user_identity(tokens)
            return True, f"Token valid. Connected as {identity.username} (Org: {identity.organization_id})"
        except httpx.HTTPStatusError as e:
            return False, f"Token test failed: HTTP {e.response.status_code} - {e.response.text}"
        except Exception as e:
            return False, f"Token test failed: {str(e)}"


def extract_callback_params(callback_url: str) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """Extract code, state, and error from OAuth callback URL.

    Args:
        callback_url: The full callback URL with query parameters

    Returns:
        Tuple of (code, state, error) - any may be None
    """
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(callback_url)
    params = parse_qs(parsed.query)

    code = params.get("code", [None])[0]
    state = params.get("state", [None])[0]
    error = params.get("error", [None])[0]
    error_description = params.get("error_description", [None])[0]

    if error:
        error = f"{error}: {error_description}" if error_description else error

    return code, state, error
