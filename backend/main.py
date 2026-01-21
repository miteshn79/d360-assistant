"""FastAPI backend for Data Cloud SE Ingestion & Debugger."""

import os
from contextlib import asynccontextmanager
from typing import Optional
from urllib.parse import urlencode

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse

from models import OAuthConfig
from salesforce_oauth import PKCEHelper, SalesforceOAuthClient, extract_callback_params

# Load environment variables
load_dotenv()

# In-memory storage for OAuth state (in production, use Redis or similar)
oauth_state_store: dict[str, dict] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler."""
    yield
    # Cleanup
    oauth_state_store.clear()


app = FastAPI(
    title="Data Cloud SE Ingestion & Debugger",
    description="API backend for Salesforce Data Cloud ingestion and debugging",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for Streamlit frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict to Streamlit URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "app": "Data Cloud SE Ingestion & Debugger",
        "version": "1.0.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/oauth/initiate")
async def initiate_oauth(
    login_url: str = Query(..., description="Salesforce login URL"),
    client_id: str = Query(..., description="Connected App Client ID"),
    redirect_uri: str = Query(..., description="OAuth redirect URI"),
):
    """Initiate OAuth flow by generating authorization URL.

    Returns the authorization URL and stores PKCE verifier for callback.
    """
    # Generate PKCE values
    code_verifier = PKCEHelper.generate_code_verifier()
    code_challenge = PKCEHelper.generate_code_challenge(code_verifier)
    state = PKCEHelper.generate_state()

    # Create OAuth config
    config = OAuthConfig(
        login_url=login_url,
        client_id=client_id,
        redirect_uri=redirect_uri,
    )

    # Generate authorization URL
    client = SalesforceOAuthClient(config)
    auth_url = client.get_authorization_url(code_challenge, state)

    # Store state and verifier for callback
    oauth_state_store[state] = {
        "code_verifier": code_verifier,
        "config": config.model_dump(),
    }

    return {
        "authorization_url": auth_url,
        "state": state,
    }


@app.get("/oauth/callback")
async def oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
):
    """Handle OAuth callback from Salesforce.

    Exchanges authorization code for tokens and returns them.
    """
    if error:
        error_msg = f"{error}: {error_description}" if error_description else error
        # Return HTML that posts message to opener window
        return HTMLResponse(content=f"""
        <html>
        <body>
        <h2>OAuth Error</h2>
        <p>{error_msg}</p>
        <script>
            if (window.opener) {{
                window.opener.postMessage({{
                    type: 'oauth_error',
                    error: '{error_msg}'
                }}, '*');
                window.close();
            }}
        </script>
        </body>
        </html>
        """)

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state parameter")

    # Retrieve stored state
    stored_data = oauth_state_store.pop(state, None)
    if not stored_data:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    code_verifier = stored_data["code_verifier"]
    config = OAuthConfig(**stored_data["config"])

    # Exchange code for tokens
    client = SalesforceOAuthClient(config)
    try:
        tokens = await client.exchange_code_for_tokens(code, code_verifier)
        await client.close()

        # Return HTML that posts tokens to opener window
        return HTMLResponse(content=f"""
        <html>
        <body>
        <h2>Authentication Successful!</h2>
        <p>You can close this window.</p>
        <script>
            if (window.opener) {{
                window.opener.postMessage({{
                    type: 'oauth_success',
                    access_token: '{tokens.access_token}',
                    refresh_token: '{tokens.refresh_token or ""}',
                    instance_url: '{tokens.instance_url}',
                    token_type: '{tokens.token_type}',
                    id_url: '{tokens.id_url or ""}'
                }}, '*');
                window.close();
            }}
        </script>
        </body>
        </html>
        """)
    except Exception as e:
        await client.close()
        return HTMLResponse(content=f"""
        <html>
        <body>
        <h2>Authentication Failed</h2>
        <p>{str(e)}</p>
        <script>
            if (window.opener) {{
                window.opener.postMessage({{
                    type: 'oauth_error',
                    error: '{str(e)}'
                }}, '*');
                window.close();
            }}
        </script>
        </body>
        </html>
        """)


@app.get("/config/defaults")
async def get_config_defaults():
    """Get default configuration values from environment."""
    return {
        "client_id": os.getenv("SF_CLIENT_ID", ""),
        "redirect_uri": os.getenv("SF_REDIRECT_URI", "http://localhost:8000/oauth/callback"),
        "llm_provider": os.getenv("LLM_PROVIDER", "perplexity"),
        "llm_model": os.getenv("LLM_MODEL", ""),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
