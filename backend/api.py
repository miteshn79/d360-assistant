"""FastAPI backend for Data Cloud Assistant."""

import asyncio
import json
import os
import secrets
import hashlib
import base64
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlencode

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import redis

from data_cloud_client import DataCloudClient
from salesforce_oauth import PKCEHelper, SalesforceOAuthClient
from yaml_schema import parse_yaml_content, normalize_schema, schema_to_table_data
from llm_client import create_llm_client, create_fallback_plan
from generators import generate_from_plan, update_plan_with_overrides
from models import (
    GenerationPlan,
    FieldGenerationPlan,
    GeneratorType,
    LLMProvider,
)
from templates import (
    ALL_TEMPLATES,
    get_template,
    get_templates_by_category,
    get_all_categories,
    template_to_yaml,
    template_to_sample_json,
)

load_dotenv()


# ============================================================================
# SESSION STORE (Redis with in-memory fallback)
# ============================================================================

class SessionStore:
    """Session storage using Redis with in-memory fallback."""

    SESSION_TTL = 86400  # 24 hours in seconds

    def __init__(self):
        self._redis: Optional[redis.Redis] = None
        self._memory: dict[str, dict] = {}
        self._init_redis()

    def _init_redis(self):
        """Initialize Redis connection if available."""
        redis_url = os.getenv("REDIS_URL")
        if redis_url:
            try:
                # Heroku Redis uses rediss:// for SSL, handle both
                self._redis = redis.from_url(
                    redis_url,
                    decode_responses=True,
                    ssl_cert_reqs=None if redis_url.startswith("rediss://") else None,
                )
                # Test connection
                self._redis.ping()
                print(f"✓ Connected to Redis")
            except Exception as e:
                print(f"⚠ Redis connection failed: {e}")
                print("  Falling back to in-memory session storage")
                self._redis = None
        else:
            # Try local Redis
            try:
                self._redis = redis.Redis(
                    host="localhost",
                    port=6379,
                    decode_responses=True,
                )
                self._redis.ping()
                print("✓ Connected to local Redis")
            except Exception:
                print("⚠ No Redis available, using in-memory session storage")
                self._redis = None

    def _key(self, session_id: str) -> str:
        """Generate Redis key for session."""
        return f"dc_session:{session_id}"

    def get(self, session_id: str) -> Optional[dict]:
        """Get session by ID."""
        if self._redis:
            try:
                data = self._redis.get(self._key(session_id))
                if data:
                    return json.loads(data)
                return None
            except Exception as e:
                print(f"Redis get error: {e}")
                # Fall back to memory
                return self._memory.get(session_id)
        return self._memory.get(session_id)

    def set(self, session_id: str, data: dict) -> None:
        """Store session data."""
        if self._redis:
            try:
                self._redis.setex(
                    self._key(session_id),
                    self.SESSION_TTL,
                    json.dumps(data),
                )
                return
            except Exception as e:
                print(f"Redis set error: {e}")
                # Fall back to memory
        self._memory[session_id] = data

    def update(self, session_id: str, updates: dict) -> dict:
        """Update session data and return updated session."""
        session = self.get(session_id)
        if session is None:
            raise KeyError(f"Session {session_id} not found")
        session.update(updates)
        self.set(session_id, session)
        return session

    def delete(self, session_id: str) -> None:
        """Delete a session."""
        if self._redis:
            try:
                self._redis.delete(self._key(session_id))
            except Exception:
                pass
        self._memory.pop(session_id, None)

    def exists(self, session_id: str) -> bool:
        """Check if session exists."""
        if self._redis:
            try:
                return self._redis.exists(self._key(session_id)) > 0
            except Exception:
                pass
        return session_id in self._memory


# Global session store
session_store = SessionStore()

app = FastAPI(
    title="Data Cloud Assistant API",
    description="Modern API for Salesforce Data Cloud operations",
    version="2.0.0",
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5000",
        "http://127.0.0.1:5000",
        "https://work-with-d360-ui-7f442aa5de9f.herokuapp.com",
        os.getenv("FRONTEND_URL", ""),  # Allow configurable frontend URL
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# MODELS
# ============================================================================

class OAuthInitRequest(BaseModel):
    login_url: str = "https://login.salesforce.com"
    consumer_key: str
    redirect_uri: str = "http://localhost:3000/oauth/callback"


class OAuthCallbackRequest(BaseModel):
    code: str
    session_id: str


class TokenExchangeRequest(BaseModel):
    session_id: str


class QueryRequest(BaseModel):
    session_id: str
    sql: str


class StreamDataRequest(BaseModel):
    session_id: str
    source_name: str
    object_name: str
    records: list[dict]


class RetrieveDataRequest(BaseModel):
    session_id: str
    data_graph_name: str
    lookup_keys: dict


class GeneratePayloadRequest(BaseModel):
    session_id: str
    yaml_schema: str
    count: int = 5
    overrides: Optional[dict] = None


class ChatRequest(BaseModel):
    session_id: str
    message: str
    context: Optional[dict] = None


class BulkJobRequest(BaseModel):
    session_id: str
    source_name: str
    object_name: str
    operation: str = "upsert"


class BulkUploadRequest(BaseModel):
    session_id: str
    job_id: str
    csv_data: str


# ============================================================================
# HELPERS
# ============================================================================

def get_session(session_id: str) -> dict:
    """Get session or raise error."""
    session = session_store.get(session_id)
    if session is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return session


def get_client(session: dict) -> DataCloudClient:
    """Create DataCloudClient from session."""
    from models import OAuthTokens, DataCloudConfig, DataCloudToken

    sf_tokens = OAuthTokens(
        access_token=session.get("access_token", ""),
        refresh_token=session.get("refresh_token"),
        instance_url=session.get("instance_url", ""),
        token_type=session.get("token_type", "Bearer"),
        issued_at=session.get("issued_at"),
    )

    dc_config = DataCloudConfig()

    dc_token = None
    if session.get("dc_token"):
        dc_token = DataCloudToken(
            access_token=session["dc_token"],
            instance_url=session.get("dc_instance_url"),
        )

    return DataCloudClient(
        config=dc_config,
        sf_tokens=sf_tokens,
        dc_token=dc_token,
    )


# ============================================================================
# AUTH ENDPOINTS
# ============================================================================

@app.post("/api/auth/init")
async def init_oauth(request: OAuthInitRequest):
    """Initialize OAuth flow and return authorization URL."""
    session_id = secrets.token_urlsafe(32)

    # Generate PKCE
    code_verifier = PKCEHelper.generate_code_verifier()
    code_challenge = PKCEHelper.generate_code_challenge(code_verifier)
    state = secrets.token_urlsafe(16)

    # Store session in Redis/memory
    session_store.set(session_id, {
        "code_verifier": code_verifier,
        "state": state,
        "login_url": request.login_url,
        "consumer_key": request.consumer_key,
        "redirect_uri": request.redirect_uri,
        "created_at": datetime.utcnow().isoformat(),
    })

    # Build auth URL
    auth_url = f"{request.login_url}/services/oauth2/authorize?" + urlencode({
        "response_type": "code",
        "client_id": request.consumer_key,
        "redirect_uri": request.redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    })

    return {
        "session_id": session_id,
        "auth_url": auth_url,
        "state": state,
    }


@app.post("/api/auth/callback")
async def handle_callback(request: OAuthCallbackRequest):
    """Exchange authorization code for tokens."""
    session = get_session(request.session_id)

    from models import OAuthConfig
    oauth_config = OAuthConfig(
        login_url=session["login_url"],
        client_id=session["consumer_key"],
        redirect_uri=session["redirect_uri"],
    )
    oauth_client = SalesforceOAuthClient(config=oauth_config)

    try:
        tokens = await oauth_client.exchange_code_for_tokens(
            authorization_code=request.code,
            code_verifier=session["code_verifier"],
        )

        # Get user info
        user_identity = await oauth_client.get_user_identity(tokens)
        user_info = {
            "user_id": user_identity.user_id,
            "username": user_identity.username,
            "display_name": user_identity.display_name,
            "email": user_identity.email,
            "organization_id": user_identity.organization_id,
        }

        # Update session with tokens and user info
        session_store.update(request.session_id, {
            "access_token": tokens.access_token,
            "refresh_token": tokens.refresh_token,
            "instance_url": tokens.instance_url,
            "token_type": tokens.token_type,
            "issued_at": tokens.issued_at,
            "user_info": user_info,
        })

        return {
            "success": True,
            "instance_url": tokens.instance_url,
            "user_info": user_info,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/auth/exchange-dc-token")
async def exchange_dc_token(request: TokenExchangeRequest):
    """Exchange Salesforce token for Data Cloud token."""
    from models import OAuthTokens, DataCloudConfig

    session = get_session(request.session_id)

    if not session.get("access_token"):
        raise HTTPException(status_code=400, detail="No Salesforce token available")

    # Create OAuthTokens from session
    sf_tokens = OAuthTokens(
        access_token=session["access_token"],
        refresh_token=session.get("refresh_token"),
        instance_url=session["instance_url"],
        token_type=session.get("token_type", "Bearer"),
        issued_at=session.get("issued_at"),
    )

    # Create DataCloudConfig with defaults
    dc_config = DataCloudConfig()

    # Create client
    client = DataCloudClient(
        config=dc_config,
        sf_tokens=sf_tokens,
    )

    try:
        dc_token = await client.exchange_for_data_cloud_token()

        # Update session with DC token
        session_store.update(request.session_id, {
            "dc_token": dc_token.access_token,
            "dc_instance_url": dc_token.instance_url,
        })

        return {
            "success": True,
            "dc_instance_url": dc_token.instance_url,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@app.get("/api/auth/session/{session_id}")
async def get_session_info(session_id: str):
    """Get current session state."""
    session = get_session(session_id)

    return {
        "authenticated": bool(session.get("access_token")),
        "has_dc_token": bool(session.get("dc_token")),
        "instance_url": session.get("instance_url"),
        "dc_instance_url": session.get("dc_instance_url"),
        "user_info": session.get("user_info"),
    }


# ============================================================================
# DATA CLOUD ENDPOINTS
# ============================================================================

@app.post("/api/data/query")
async def execute_query(request: QueryRequest):
    """Execute SQL query against Data Cloud."""
    session = get_session(request.session_id)
    client = get_client(session)

    try:
        result = await client.execute_query(request.sql)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/metadata")
async def get_metadata(session_id: str = Query(...)):
    """Get Data Cloud metadata."""
    session = get_session(session_id)
    client = get_client(session)

    try:
        result = await client.get_metadata()
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/data/stream")
async def stream_data(request: StreamDataRequest):
    """Stream data to Data Cloud Ingestion API."""
    session = get_session(request.session_id)
    client = get_client(session)

    try:
        # Build the ingestion endpoint path
        endpoint_path = f"/api/v1/ingest/sources/{request.source_name}/{request.object_name}"

        # Send each record - client will wrap in {"data": [...]} format
        # Records should be a list of objects
        results = []
        for record in request.records:
            result = await client.send_ingestion_event(
                endpoint_path=endpoint_path,
                payload=record,  # Single record, client wraps in {"data": [record]}
            )
            results.append({
                "status_code": result.status_code,
                "correlation_id": result.correlation_id,
                "response_body": result.response_body,
            })

        # Check if all succeeded (2xx status codes)
        all_success = all(r["status_code"] and 200 <= r["status_code"] < 300 for r in results)

        return {
            "success": all_success,
            "records_sent": len(results),
            "results": results,
        }
    except Exception as e:
        import traceback
        error_detail = f"{str(e)}\n{traceback.format_exc()}"
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@app.post("/api/data/retrieve")
async def retrieve_data(request: RetrieveDataRequest):
    """Retrieve data from Data Graph by record ID."""
    session = get_session(request.session_id)
    client = get_client(session)

    try:
        # Get the record ID from lookup_keys (typically the first value)
        record_id = None
        for key, value in request.lookup_keys.items():
            record_id = value.strip() if isinstance(value, str) else value
            break

        if not record_id:
            raise HTTPException(status_code=400, detail="No record ID provided in lookup_keys")

        # Build the endpoint path: /api/v1/dataGraph/{graphName}/{recordId}
        base_url = client._get_base_url(use_dc_token=True)
        data_graph_name = request.data_graph_name.strip() if request.data_graph_name else ""
        url = f"{base_url}/api/v1/dataGraph/{data_graph_name}/{record_id}"

        headers = client._get_auth_headers(use_dc_token=True)
        headers["Accept"] = "application/json"

        response = await client._http_client.get(url, headers=headers)
        response.raise_for_status()

        return {"data": response.json()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@app.get("/api/data/profiles")
async def get_profiles(session_id: str = Query(...), data_model: Optional[str] = None):
    """Get profile metadata or query profiles."""
    session = get_session(session_id)
    client = get_client(session)

    try:
        result = await client.get_profile_metadata(data_model_name=data_model)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/data/insights")
async def get_insights(session_id: str = Query(...)):
    """Get calculated insights metadata."""
    session = get_session(session_id)
    client = get_client(session)

    try:
        result = await client.get_insights_metadata()
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# BULK INGESTION ENDPOINTS
# ============================================================================

@app.post("/api/bulk/create")
async def create_bulk_job(request: BulkJobRequest):
    """Create a bulk ingestion job."""
    session = get_session(request.session_id)
    client = get_client(session)

    try:
        result = await client.create_bulk_job(
            source_name=request.source_name,
            object_name=request.object_name,
            operation=request.operation,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/bulk/upload")
async def upload_bulk_data(request: BulkUploadRequest):
    """Upload data to a bulk job."""
    session = get_session(request.session_id)
    client = get_client(session)

    try:
        result = await client.upload_bulk_data(
            job_id=request.job_id,
            csv_data=request.csv_data,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/bulk/{job_id}/close")
async def close_bulk_job(job_id: str, session_id: str = Query(...)):
    """Close a bulk job to start processing."""
    session = get_session(session_id)
    client = get_client(session)

    try:
        result = await client.close_bulk_job(job_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/bulk/{job_id}/status")
async def get_bulk_job_status(job_id: str, session_id: str = Query(...)):
    """Get bulk job status."""
    session = get_session(session_id)
    client = get_client(session)

    try:
        result = await client.get_bulk_job_status(job_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/bulk/jobs")
async def list_bulk_jobs(session_id: str = Query(...)):
    """List all bulk jobs."""
    session = get_session(session_id)
    client = get_client(session)

    try:
        result = await client.list_bulk_jobs()
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# SCHEMA & PAYLOAD GENERATION
# ============================================================================

@app.post("/api/schema/parse")
async def parse_schema(yaml_content: str):
    """Parse YAML schema and return normalized structure."""
    try:
        parsed = parse_yaml_content(yaml_content)
        normalized = normalize_schema(parsed)
        table_data = schema_to_table_data(normalized)
        return {
            "success": True,
            "schema": normalized,
            "table_data": table_data,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/payload/generate")
async def generate_payload(request: GeneratePayloadRequest):
    """Generate test payloads from schema."""
    try:
        parsed = parse_yaml_content(request.yaml_schema)
        normalized = normalize_schema(parsed)

        # Create generation plan
        field_plans = []
        for field in normalized.fields:
            field_plans.append(FieldGenerationPlan(
                field_name=field.name,
                generator_type=GeneratorType.AUTO,
                data_type=field.data_type,
            ))

        plan = GenerationPlan(
            schema_name=normalized.name,
            record_count=request.count,
            field_plans=field_plans,
        )

        # Apply overrides if provided
        if request.overrides:
            plan = update_plan_with_overrides(plan, request.overrides)

        # Generate records
        records = generate_from_plan(plan)

        return {
            "success": True,
            "records": records,
            "count": len(records),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ============================================================================
# TEMPLATES
# ============================================================================

@app.get("/api/templates")
async def get_templates():
    """Get all available templates."""
    templates = []
    for template_id, template in ALL_TEMPLATES.items():
        templates.append({
            "id": template_id,
            "name": template.name,
            "description": template.description,
            "category": template.category,
            "icon": template.icon,
            "fields_count": len(template.fields),
        })
    return {"templates": templates}


@app.get("/api/templates/{template_id}")
async def get_template_detail(template_id: str):
    """Get detailed template information."""
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    return {
        "id": template_id,
        "name": template.name,
        "description": template.description,
        "category": template.category,
        "icon": template.icon,
        "fields": [
            {
                "name": f.name,
                "data_type": f.data_type,
                "required": f.required,
                "is_primary_key": f.is_primary_key,
                "is_profile_id": f.is_profile_id,
                "is_event_time": f.is_event_time,
                "description": f.description,
                "example": f.example,
            }
            for f in template.fields
        ],
        "yaml": template_to_yaml(template),
        "sample_json": template_to_sample_json(template),
    }


@app.get("/api/templates/categories")
async def get_template_categories():
    """Get all template categories."""
    return {"categories": get_all_categories()}


# ============================================================================
# AI CHAT
# ============================================================================

@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Send message to AI assistant for schema help."""
    # Get LLM API key from environment
    llm_api_key = (
        os.getenv("LLM_API_KEY") or
        os.getenv("PERPLEXITY_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        os.getenv("ANTHROPIC_API_KEY")
    )

    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No LLM API key configured")

    try:
        # Determine provider from key
        if "pplx" in llm_api_key.lower() or llm_api_key.startswith("pplx-"):
            provider = LLMProvider.PERPLEXITY
        elif llm_api_key.startswith("sk-ant"):
            provider = LLMProvider.ANTHROPIC
        else:
            provider = LLMProvider.OPENAI

        client = create_llm_client(provider, llm_api_key)

        # Build system prompt for schema assistance
        system_prompt = """You are a Salesforce Data Cloud expert assistant. Help users design data schemas for streaming ingestion.

When users describe their use case, help them:
1. Identify the right fields for their data
2. Choose appropriate data types (text, number, date, boolean)
3. Determine which field should be the primary key
4. Identify the profile ID field (for identity resolution)
5. Identify the event timestamp field

Provide responses in a conversational but concise manner. When appropriate, suggest a YAML schema structure.

Example YAML schema format:
```yaml
name: MyEventSchema
fields:
  - name: event_id
    type: text
    primary_key: true
  - name: customer_id
    type: text
    profile_id: true
  - name: event_time
    type: date
    event_time: true
  - name: amount
    type: number
```"""

        response = await client.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": request.message},
            ],
            context=request.context,
        )
        await client.close()

        return {
            "success": True,
            "message": response,
        }
    except Exception as e:
        if 'client' in locals():
            await client.close()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# SAVED CONFIGURATIONS
# ============================================================================

class SavedConfig(BaseModel):
    """A saved configuration for reuse."""
    name: str  # e.g., "VietnamAir Credit Cards"
    description: Optional[str] = None
    # OAuth settings
    login_url: Optional[str] = None
    consumer_key: Optional[str] = None
    # Ingestion settings
    source_name: Optional[str] = None
    object_name: Optional[str] = None
    yaml_schema: Optional[str] = None
    # Required field mappings
    profile_id_field: Optional[str] = None
    primary_key_field: Optional[str] = None
    datetime_field: Optional[str] = None
    # Retrieval settings
    data_graph_name: Optional[str] = None
    lookup_key: Optional[str] = None
    lookup_value: Optional[str] = None
    # Sample use case for data generation
    sample_use_case: Optional[str] = None
    # Sample payload (JSON string)
    sample_payload: Optional[str] = None
    # Metadata
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ConfigListResponse(BaseModel):
    """Response with list of saved configurations."""
    configs: list[dict]


@app.get("/api/configs")
async def list_configs():
    """List all saved configurations."""
    configs = []

    if session_store._redis:
        # Get all config keys from Redis
        try:
            keys = session_store._redis.keys("dc_config:*")
            for key in keys:
                data = session_store._redis.get(key)
                if data:
                    config = json.loads(data)
                    configs.append({
                        "name": config.get("name"),
                        "description": config.get("description"),
                        "source_name": config.get("source_name"),
                        "object_name": config.get("object_name"),
                        "created_at": config.get("created_at"),
                    })
        except Exception as e:
            print(f"Error listing configs: {e}")

    return {"configs": configs}


@app.get("/api/configs/{config_name}")
async def get_config(config_name: str):
    """Get a specific saved configuration."""
    key = f"dc_config:{config_name}"

    if session_store._redis:
        try:
            data = session_store._redis.get(key)
            if data:
                return {"config": json.loads(data)}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=404, detail=f"Configuration '{config_name}' not found")


@app.post("/api/configs")
async def save_config(config: SavedConfig):
    """Save a configuration."""
    key = f"dc_config:{config.name}"

    # Add timestamps
    now = datetime.utcnow().isoformat()
    config_dict = config.dict()
    config_dict["created_at"] = config_dict.get("created_at") or now
    config_dict["updated_at"] = now

    if session_store._redis:
        try:
            session_store._redis.set(key, json.dumps(config_dict))
            return {"success": True, "message": f"Configuration '{config.name}' saved"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=500, detail="Redis not available for saving configurations")


@app.delete("/api/configs/{config_name}")
async def delete_config(config_name: str):
    """Delete a saved configuration."""
    key = f"dc_config:{config_name}"

    if session_store._redis:
        try:
            deleted = session_store._redis.delete(key)
            if deleted:
                return {"success": True, "message": f"Configuration '{config_name}' deleted"}
            raise HTTPException(status_code=404, detail=f"Configuration '{config_name}' not found")
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=500, detail="Redis not available")


# ============================================================================
# WEBSITE BUILDER AGENT
# ============================================================================

class WebsiteProjectInput(BaseModel):
    """Input for website project."""
    customer_name: str
    country: str
    industry: str
    use_case: str
    branding_assets: Optional[list[dict]] = None
    llm_provider: Optional[str] = "claude"
    llm_api_key: Optional[str] = None
    heroku_api_key: Optional[str] = None
    use_default_heroku: Optional[bool] = True


class WebsiteBuilderChatRequest(BaseModel):
    """Chat request for website builder agent."""
    messages: list[dict]
    project_context: Optional[dict] = None


class WebsiteBuilderChatResponse(BaseModel):
    """Chat response from website builder agent."""
    response: str
    project_updates: Optional[dict] = None


async def get_claude_client():
    """Get Claude API client for website builder."""
    api_key = os.getenv("ANTHROPIC_API_KEY") or os.getenv("CLAUDE_API_KEY") or os.getenv("LLM_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="Claude API key not configured. Set ANTHROPIC_API_KEY, CLAUDE_API_KEY, or LLM_API_KEY environment variable."
        )
    return api_key


WEBSITE_BUILDER_SYSTEM_PROMPT = """You are a Website Builder Agent that helps Solution Engineers create demo websites integrated with Salesforce Data Cloud, Agentforce, and Personalization.

Your role is to gather requirements through friendly conversation and then generate a complete website. You should:
1. Ask clarifying questions to understand the customer's needs
2. Collect: customer name, country, industry, use case details, branding preferences
3. Suggest appropriate features based on the industry
4. When ready, confirm the project details before generation

You have expertise in these industries and their typical website needs:
- Airline: Flight booking, loyalty programs, travel search, seat selection
- Retail: Product catalog, shopping cart, wishlist, order tracking
- Banking: Account dashboard, transactions, loan applications, card services
- Healthcare: Patient portal, appointments, prescriptions, health records
- Telecommunications: Plan selection, device catalog, account management, support

When generating websites, you'll create:
- Responsive HTML/CSS/JS pages
- User registration & login flows
- Product/service catalog with search
- Booking/purchase flows with cart
- Data Cloud event tracking hooks (ready for beacon integration)
- Personalization zones (ready for Salesforce Personalization)
- Agentforce chat widget placeholder

Be conversational, helpful, and gather enough detail to create a great demo website.
Always respond in a friendly, professional tone. Use markdown for formatting when helpful."""


@app.post("/api/website-builder/chat")
async def website_builder_chat(request: WebsiteBuilderChatRequest):
    """Chat endpoint for website builder agent."""
    api_key = await get_claude_client()

    # Build messages for Claude
    messages = []
    for msg in request.messages:
        messages.append({
            "role": msg.get("role", "user"),
            "content": msg.get("content", "")
        })

    # Add project context if available
    context_suffix = ""
    if request.project_context:
        context_parts = []
        if request.project_context.get("customerName"):
            context_parts.append(f"Customer: {request.project_context['customerName']}")
        if request.project_context.get("country"):
            context_parts.append(f"Country: {request.project_context['country']}")
        if request.project_context.get("industry"):
            context_parts.append(f"Industry: {request.project_context['industry']}")
        if request.project_context.get("useCase"):
            context_parts.append(f"Use Case: {request.project_context['useCase']}")
        if context_parts:
            context_suffix = f"\n\n[Current project context: {', '.join(context_parts)}]"

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "claude-opus-4-5-20251101",
                    "max_tokens": 4096,
                    "system": WEBSITE_BUILDER_SYSTEM_PROMPT + context_suffix,
                    "messages": messages,
                },
            )
            response.raise_for_status()

            data = response.json()
            assistant_response = data["content"][0]["text"]

            return WebsiteBuilderChatResponse(
                response=assistant_response,
                project_updates=None
            )

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"Claude API error: {e.response.text}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@app.post("/api/website-builder/generate")
async def generate_website(project: WebsiteProjectInput):
    """Generate website code based on project specifications."""
    api_key = await get_claude_client()

    # Use user's API key if provided
    if project.llm_api_key and project.llm_provider != "claude":
        # For future: support other LLM providers
        pass

    generation_prompt = f"""Generate a complete demo website for the following project:

**Customer:** {project.customer_name}
**Country:** {project.country}
**Industry:** {project.industry}
**Use Case:** {project.use_case}

Requirements:
1. Create a responsive, modern website with these pages:
   - Homepage with hero section and key features
   - Product/Service listing page
   - Detail page for individual items
   - Search/filter functionality
   - User registration and login forms
   - Booking/Cart/Checkout flow
   - Confirmation page
   - User account/dashboard page

2. Include Data Cloud tracking hooks:
   - Page view events
   - Search events
   - Product/item view events
   - Add to cart events
   - Purchase/booking completion events
   - User identity events (on login/register)

3. Add placeholder for Agentforce chat widget

4. Add personalization zones (marked with comments)

5. Use professional design with:
   - Clean, modern UI
   - Responsive layout (mobile-first)
   - Professional color scheme appropriate for {project.industry}
   - High-quality stock photo placeholders from Unsplash

6. Tech stack:
   - Express.js backend
   - Vanilla HTML/CSS/JS frontend
   - No external frameworks (keep it simple)

Return the complete code as a JSON object with this structure:
{{
  "files": [
    {{"path": "server.js", "content": "..."}},
    {{"path": "package.json", "content": "..."}},
    {{"path": "public/index.html", "content": "..."}},
    {{"path": "public/css/style.css", "content": "..."}},
    {{"path": "public/js/main.js", "content": "..."}},
    {{"path": "public/js/datacloud.js", "content": "..."}},
    ... other files
  ],
  "instructions": "Setup and deployment instructions"
}}

Generate production-ready code that can be deployed immediately to Heroku."""

    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "claude-opus-4-5-20251101",
                    "max_tokens": 64000,
                    "system": "You are an expert web developer. Generate complete, production-ready website code. Return only valid JSON with the file structure requested. No markdown formatting around the JSON.",
                    "messages": [
                        {"role": "user", "content": generation_prompt}
                    ],
                },
            )
            response.raise_for_status()

            data = response.json()
            response_text = data["content"][0]["text"]

            # Parse the JSON response
            try:
                # Extract JSON from response
                text = response_text.strip()
                if "```" in text:
                    lines = text.split("\n")
                    json_lines = []
                    in_json = False
                    for line in lines:
                        if line.strip().startswith("```") and not in_json:
                            in_json = True
                            continue
                        elif line.strip().startswith("```") and in_json:
                            break
                        elif in_json:
                            json_lines.append(line)
                    if json_lines:
                        text = "\n".join(json_lines)

                start_idx = text.find("{")
                end_idx = text.rfind("}") + 1
                if start_idx >= 0 and end_idx > start_idx:
                    text = text[start_idx:end_idx]

                website_data = json.loads(text)
                return {
                    "success": True,
                    "website": website_data,
                    "project": {
                        "customer_name": project.customer_name,
                        "country": project.country,
                        "industry": project.industry,
                    }
                }
            except json.JSONDecodeError as e:
                return {
                    "success": False,
                    "error": f"Failed to parse generated website: {str(e)}",
                    "raw_response": response_text[:2000]
                }

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"Claude API error: {e.response.text}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Generation failed: {str(e)}")


@app.post("/api/website-builder/deploy")
async def deploy_website(
    website_data: dict,
    app_name: str = Query(..., description="Heroku app name"),
    heroku_api_key: Optional[str] = Query(None, description="User's Heroku API key")
):
    """Deploy generated website to Heroku."""
    # Use user's Heroku key or default
    api_key = heroku_api_key or os.getenv("HEROKU_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="Heroku API key required. Provide your key or contact admin for shared deployment."
        )

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            # Check if app exists, if not create it
            check_response = await client.get(
                f"https://api.heroku.com/apps/{app_name}",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/vnd.heroku+json; version=3",
                }
            )

            if check_response.status_code == 404:
                # Create the app
                create_response = await client.post(
                    "https://api.heroku.com/apps",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Accept": "application/vnd.heroku+json; version=3",
                        "Content-Type": "application/json",
                    },
                    json={"name": app_name}
                )
                if create_response.status_code not in [200, 201]:
                    raise HTTPException(
                        status_code=create_response.status_code,
                        detail=f"Failed to create Heroku app: {create_response.text}"
                    )

            # For now, return the files and instructions for manual deployment
            # Full automated deployment would require git push or Heroku Build API
            return {
                "success": True,
                "message": f"Website ready for deployment to '{app_name}'",
                "app_url": f"https://{app_name}.herokuapp.com",
                "files": website_data.get("files", []),
                "instructions": [
                    "1. Download the generated files",
                    "2. Initialize git: git init",
                    "3. Add Heroku remote: heroku git:remote -a " + app_name,
                    "4. Commit and push: git add . && git commit -m 'Initial deploy' && git push heroku main",
                    "Or use the Heroku CLI: heroku apps:create " + app_name + " && git push heroku main"
                ]
            }

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"Heroku API error: {e.response.text}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Deployment failed: {str(e)}")


# ============================================================================
# HEALTH CHECK
# ============================================================================

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    redis_status = "connected" if session_store._redis else "not connected (using in-memory)"
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "version": "2.0.0",
        "redis": redis_status,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
