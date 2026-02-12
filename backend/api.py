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
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx
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
        "http://localhost:8000",
        "http://127.0.0.1:8000",
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
    dmo_name: str = "ssot__Individual__dlm"
    live: bool = False  # Set to True to get real-time data instead of precalculated


class GeneratePayloadRequest(BaseModel):
    session_id: str
    yaml_schema: str
    count: int = 5
    overrides: Optional[dict] = None


class ChatRequest(BaseModel):
    session_id: str
    message: str
    context: Optional[dict] = None


class DataGenerationChatRequest(BaseModel):
    session_id: str
    message: str
    conversation_history: Optional[list[dict]] = None


class GenerateScriptRequest(BaseModel):
    session_id: str
    industry: str
    country: str
    profile_count: int
    months_of_data: int
    use_cases: str
    additional_requirements: Optional[str] = None


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
    finally:
        await client.close()


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


@app.get("/api/data/data-graphs")
async def get_data_graphs(session_id: str = Query(...)):
    """Get Data Graph metadata including available graphs, DMOs, and DLOs."""
    session = get_session(session_id)
    client = get_client(session)

    try:
        # Fetch data graph metadata and regular metadata in parallel
        data_graph_result, metadata_result = await asyncio.gather(
            client.get_data_graphs_metadata(),
            client.get_metadata(),
            return_exceptions=True
        )

        # Debug: Log the raw responses
        print(f"[DEBUG] Data Graph API response type: {type(data_graph_result)}")
        if isinstance(data_graph_result, dict):
            print(f"[DEBUG] Data Graph API keys: {data_graph_result.keys()}")
            if "metadata" in data_graph_result:
                meta = data_graph_result["metadata"]
                print(f"[DEBUG] metadata is list: {isinstance(meta, list)}, len: {len(meta) if isinstance(meta, list) else 'N/A'}")
                if isinstance(meta, list) and len(meta) > 0:
                    print(f"[DEBUG] First item keys: {meta[0].keys() if isinstance(meta[0], dict) else meta[0]}")
        elif isinstance(data_graph_result, list):
            print(f"[DEBUG] Data Graph API is list, len: {len(data_graph_result)}")
            if len(data_graph_result) > 0:
                print(f"[DEBUG] First item: {data_graph_result[0]}")
        elif isinstance(data_graph_result, Exception):
            print(f"[DEBUG] Data Graph API error: {data_graph_result}")

        # Process data graphs
        # API returns: developerName, description, primaryObjectName, version, status, etc.
        data_graphs = []
        if not isinstance(data_graph_result, Exception):
            # The API may return the graphs directly as a list or wrapped in "metadata"
            raw_graphs = data_graph_result
            if isinstance(data_graph_result, dict):
                raw_graphs = data_graph_result.get("metadata", data_graph_result.get("dataGraphs", []))
            if not isinstance(raw_graphs, list):
                raw_graphs = []

            for graph in raw_graphs:
                if isinstance(graph, dict):
                    # Use developerName as the API name (this is what you use in queries)
                    dev_name = graph.get("developerName", graph.get("name", ""))
                    if not dev_name:
                        continue

                    # Extract lookup keys from the graph metadata
                    lookup_keys = []
                    primary_object = graph.get("primaryObjectName", graph.get("rootDmoName", ""))

                    # Check for object field which may contain lookup key info
                    obj_info = graph.get("object", {})
                    if isinstance(obj_info, dict):
                        fields = obj_info.get("fields", [])
                        if isinstance(fields, list):
                            for field in fields:
                                if isinstance(field, dict):
                                    field_name = field.get("name", field.get("developerName", ""))
                                    if field_name:
                                        lookup_keys.append({
                                            "name": field_name,
                                            "dmoName": primary_object
                                        })

                    # Also check dmoLookupKeys if present
                    dmo_lookup_keys = graph.get("dmoLookupKeys", [])
                    if isinstance(dmo_lookup_keys, list):
                        for dmo_key in dmo_lookup_keys:
                            if isinstance(dmo_key, dict):
                                dmo_name = dmo_key.get("dmoName", primary_object)
                                keys = dmo_key.get("keys", [])
                                if isinstance(keys, list):
                                    for key in keys:
                                        if isinstance(key, str):
                                            lookup_keys.append({
                                                "name": key,
                                                "dmoName": dmo_name
                                            })

                    # Always add UnifiedIndividualId__c as it's a special path-based lookup
                    # that works for all Data Graphs (not listed in metadata but always available)
                    unified_id_key = {"name": "UnifiedIndividualId__c", "dmoName": primary_object or "UnifiedIndividual__dlm"}
                    if not any(lk["name"] == "UnifiedIndividualId__c" for lk in lookup_keys):
                        lookup_keys.insert(0, unified_id_key)

                    # If still no other lookup keys found, add ssot__Id__c as fallback
                    if len(lookup_keys) <= 1:
                        lookup_keys.append({"name": "ssot__Id__c", "dmoName": primary_object or "ssot__Individual__dlm"})

                    data_graphs.append({
                        "name": dev_name,
                        "label": graph.get("description", dev_name) or dev_name,
                        "lookupKeys": lookup_keys
                    })

        # Process DMOs and DLOs from metadata
        dmos = []
        dlos = []
        if not isinstance(metadata_result, Exception):
            raw_metadata = metadata_result.get("metadata", []) if isinstance(metadata_result, dict) else []
            for obj in raw_metadata:
                if isinstance(obj, dict):
                    name = obj.get("name", "")
                    label = obj.get("label", name)
                    category = obj.get("category", "")

                    # DMOs end with __dlm, DLOs end with __dll
                    if name.endswith("__dlm"):
                        dmos.append({"name": name, "label": label})
                    elif name.endswith("__dll"):
                        dlos.append({"name": name, "label": label})

        return {
            "dataGraphs": data_graphs,
            "dmos": dmos,
            "dlos": dlos
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        await client.close()


@app.post("/api/data/stream")
async def stream_data(request: StreamDataRequest):
    """Stream data to Data Cloud Ingestion API."""
    session = get_session(request.session_id)
    client = get_client(session)

    try:
        # Sanitize source and object names (remove tabs, newlines, extra whitespace)
        source_name = request.source_name.strip().replace('\t', '').replace('\n', '').replace('\r', '')
        object_name = request.object_name.strip().replace('\t', '').replace('\n', '').replace('\r', '')

        # Build the ingestion endpoint path
        endpoint_path = f"/api/v1/ingest/sources/{source_name}/{object_name}"

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
        # Get the lookup key name and value
        lookup_key = None
        lookup_value = None
        for key, value in request.lookup_keys.items():
            lookup_key = key.strip() if isinstance(key, str) else key
            lookup_value = value.strip() if isinstance(value, str) else str(value)
            break

        if not lookup_value:
            raise HTTPException(status_code=400, detail="No lookup value provided in lookup_keys")

        base_url = client._get_base_url(use_dc_token=True)
        data_graph_name = request.data_graph_name.strip() if request.data_graph_name else ""
        dmo_name = request.dmo_name.strip() if request.dmo_name else "ssot__Individual__dlm"

        if lookup_key == "UnifiedIndividualId__c":
            # Primary key lookup: use path-based format
            url = f"{base_url}/api/v1/dataGraph/{data_graph_name}/{lookup_value}"
            params = {}
        else:
            # Non-primary key lookup: use lookupKeys query parameter
            # Format: lookupKeys=[DMO__dlm.field__c=value]
            lookup_keys_param = f"[{dmo_name}.{lookup_key}={lookup_value}]"
            url = f"{base_url}/api/v1/dataGraph/{data_graph_name}"
            params = {"lookupKeys": lookup_keys_param}

        # Add live parameter for real-time data retrieval
        if request.live:
            params["live"] = "true"

        headers = client._get_auth_headers(use_dc_token=True)
        headers["Accept"] = "application/json"

        print(f"[DEBUG] Data Graph Query - URL: {url}, params: {params}, live: {request.live}")
        response = await client._http_client.get(url, headers=headers, params=params)
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
        "fields": [
            {
                "name": f.name,
                "data_type": f.type,
                "required": f.required,
                "is_primary_key": f.is_primary_key,
                "is_profile_id": f.is_profile_id,
                "is_event_time": f.is_datetime,
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

        # Build system prompt for schema assistance - Streaming Ingestion Setup Guide
        system_prompt = """You are a Salesforce Data Cloud expert assistant helping Solution Engineers set up their first Streaming Ingestion API source. Your goal is to make this technical task accessible and guide users step-by-step.

## YOUR CONVERSATION FLOW

### Step 1: Gather Context
Start by asking the user about:
1. **Industry**: What industry is their customer in? (Airlines, Hotels, Banking, Telcos, Retail, Healthcare, etc.)
2. **Use Case**: What specific scenario do they want to demonstrate? (e.g., real-time personalization, fraud detection, loyalty program, etc.)

### Step 2: Determine Ingestion Type
Based on their use case, ask if they need:
- **Custom Web SDK** - For capturing web/mobile interaction data (browsing behavior, product views, cart actions)
- **Custom Streaming Data Stream** - For backend system data (transactions, bookings, events from external systems)

### Step 3: Propose Schema Based on Industry & Type

#### For Custom Web SDK (Web/Mobile Interactions):
Propose custom attributes for the web catalog. Keep to a MAXIMUM of 10 custom attributes that fit the industry.

**Airlines Example:**
- Catalog attributes: origin, destination, travel_dates, class_of_service, number_of_passengers
- Cart add-ons: seat_selection, travel_insurance, meal_preference, lounge_access, upgrade_choice

**Hotels Example:**
- Catalog attributes: destination_city, check_in_date, check_out_date, number_of_guests, number_of_rooms
- Cart add-ons: car_rental, executive_lounge, airport_transfer, late_checkout

#### For Custom Streaming Data Stream:
Propose a schema with 6-12 fields. If user explicitly asks for more than 12 fields, ask them to provide the schema.

IMPORTANT: Use only these data types in the schema:
- `type: string` for text fields
- `type: number` for numeric fields (amounts, counts, scores)
- `type: string` with `format: date-time` for datetime/timestamp fields
- `type: boolean` for true/false fields

After presenting the schema, always tell the user which fields should be configured as:
- **Primary Key** - the unique identifier for each record (configured in Data Cloud when creating the data stream)
- **Event Date/Time** - the timestamp field (configured in Data Cloud when creating the data stream)
- **Profile ID** - the field used for identity resolution linking (configured when creating the DMO relationship)

**Banking - Credit Card Transactions:**
```yaml
openapi: 3.0.3
components:
  schemas:
    CardTransaction:
      type: object
      properties:
        txn_id:
          type: string
        txn_datetime:
          type: string
          format: date-time
        customer_id:
          type: string
        card_number:
          type: string
        merchant_category_code:
          type: string
        merchant_name:
          type: string
        txn_amount:
          type: number
        txn_currency:
          type: string
        channel:
          type: string
        transaction_description:
          type: string
```
After presenting, tell the user: "When you create the data stream in Data Cloud, set **txn_id** as the Primary Key, **txn_datetime** as the Event Date/Time field, and use **customer_id** as the Profile ID when you build the DMO relationship."

**Telcos - Prepaid Top Up:**
```yaml
openapi: 3.0.3
components:
  schemas:
    PrepaidTopUp:
      type: object
      properties:
        txn_id:
          type: string
        txn_datetime:
          type: string
          format: date-time
        msisdn:
          type: string
        amount:
          type: number
        package_id:
          type: string
        package_name:
          type: string
        topup_channel:
          type: string
```
After presenting, tell the user: "When you create the data stream, set **txn_id** as the Primary Key, **txn_datetime** as the Event Date/Time, and use **msisdn** as the Profile ID for identity resolution."

**Airlines - Real-Time Booking (Amadeus-style):**
```yaml
openapi: 3.0.3
components:
  schemas:
    FlightBooking:
      type: object
      properties:
        booking_id:
          type: string
        booking_datetime:
          type: string
          format: date-time
        pax_firstname:
          type: string
        pax_lastname:
          type: string
        pax_email:
          type: string
        origin:
          type: string
        destination:
          type: string
        travel_date:
          type: string
          format: date-time
        cancelled_flag:
          type: boolean
        ticket_amount:
          type: number
        fare_class:
          type: string
        cabin:
          type: string
```
After presenting, tell the user: "When you create the data stream, set **booking_id** as the Primary Key, **booking_datetime** as the Event Date/Time, and use **pax_email** as the Profile ID for identity resolution."

### Step 4: End the Conversation
After presenting the YAML schema and telling the user which fields to use as Primary Key, Event Date/Time, and Profile ID, end your response. Do NOT provide setup instructions for Data Cloud — the app will display those automatically. Do NOT offer further help or ask follow-up questions.

## RESPONSE STYLE
- Be conversational and encouraging - this is intimidating for many engineers
- Use clear step-by-step instructions
- Include the YAML code blocks when proposing schemas
- Acknowledge that Data Cloud setup has a learning curve
- Keep explanations concise but complete

## CRITICAL: YAML SCHEMA FORMAT
You MUST always use this exact OpenAPI 3.0.3 format for all schemas. This is the format Salesforce Data Cloud accepts for Streaming Ingestion API definitions. Do NOT use any other format.

```yaml
openapi: 3.0.3
components:
  schemas:
    SchemaObjectName:
      type: object
      properties:
        field_name:
          type: string
        numeric_field:
          type: number
        datetime_field:
          type: string
          format: date-time
        boolean_field:
          type: boolean
```

Rules:
- Always start with `openapi: 3.0.3`
- Schema goes under `components.schemas.{ObjectName}.type: object.properties`
- The ObjectName should be PascalCase with no spaces (e.g., CardTransaction, FlightBooking, PrepaidTopUp)
- Supported types: `string`, `number`, `boolean`
- For date/datetime fields, use `type: string` with `format: date-time`
- Do NOT include primary_key, profile_id, or event_time markers in the YAML - these are configured in the Data Cloud UI
- Instead, always tell the user in your message which fields to set as Primary Key, Event Date/Time, and Profile ID"""

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


@app.post("/api/data-generation/chat")
async def data_generation_chat(request: DataGenerationChatRequest):
    """Chat endpoint for data generation assistance."""
    # Get LLM API key from environment (same as schema chat)
    llm_api_key = (
        os.getenv("LLM_API_KEY") or
        os.getenv("PERPLEXITY_API_KEY") or
        os.getenv("OPENAI_API_KEY") or
        os.getenv("ANTHROPIC_API_KEY")
    )

    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No LLM API key configured")

    try:
        # Determine provider from key (same logic as schema chat)
        if "pplx" in llm_api_key.lower() or llm_api_key.startswith("pplx-"):
            provider = LLMProvider.PERPLEXITY
        elif llm_api_key.startswith("sk-ant"):
            provider = LLMProvider.ANTHROPIC
        else:
            provider = LLMProvider.OPENAI

        client = create_llm_client(provider, llm_api_key)

        # Build system prompt for data generation guidance
        system_prompt = """You are a Data Generation Assistant helping Salesforce Solution Engineers create realistic demo data for Data Cloud demonstrations.

## YOUR ROLE

Help SEs generate Python scripts that produce industry-specific, country-localized demo data. You must be flexible and support ANY industry vertical the SE mentions.

## CONVERSATION FLOW

### Step 1: Understand Requirements
Ask the SE about:
1. **Industry/Vertical**: What industry is this demo for?
   - Common examples: Airlines, Hotels, Banking, Insurance, Telco, Retail, Healthcare, Manufacturing, Automotive, Real Estate, Education
   - Accept ANY industry the SE mentions - adapt your suggestions accordingly

2. **Country/Region**: Where are the customers based?
   - Important for: realistic names, addresses, phone formats, cultural context
   - Examples: Vietnam, Indonesia, USA, Japan, Thailand, Singapore, India, Australia, UK, etc.

3. **Number of customer/entity profiles**: How many primary records? (Max 10,000)
   - For B2C: customers, subscribers, patients, travelers
   - For B2B: companies, accounts, organizations

4. **Historical data period**: How many months back? (Max 12 months)
   - This determines transaction volume: more months = more transactions
   - Typical: 6-12 months gives realistic patterns

5. **Use cases to demonstrate**: What will they show with this data?
   - Real-time personalization
   - Churn prediction & prevention
   - Customer 360 views
   - Segmentation & targeting
   - Journey orchestration
   - Next-best-action/offer
   - Fraud detection
   - Loyalty program optimization

### Step 2: Propose Data Model

Based on the industry, propose a data model with these components:

**1. Profile/Entity Data** (1 file)
The core customer/entity record with demographics and attributes
- Industry-specific attributes (travelers, subscribers, patients, policyholders, etc.)
- Country-specific: names, addresses, phone numbers, email formats
- Demographic attributes: age, gender, location, language preferences
- Account information: registration date, status, segment

**2. Transaction/Event Data** (2-4 files)
The main business transactions/events that occur
- Industry examples:
  - Airlines: bookings, flight_searches, ancillary_purchases
  - Banking: card_transactions, loan_applications, account_transfers
  - Telco: calls, sms, data_usage, recharges
  - Retail: purchases, returns, product_views
  - Insurance: claims, policy_renewals, premium_payments
  - Hotels: reservations, checkins, room_service_orders
  - Healthcare: appointments, prescriptions, lab_results
  - Automotive: service_appointments, parts_purchases, test_drives
  - Manufacturing: orders, shipments, quality_checks

**3. Behavioral/Interaction Data** (1-2 files)
Digital interactions and engagement
- web_sessions, app_events, email_opens, search_events, cart_abandonments

**4. Calculated/Aggregate Data** (1 file)
Metrics and scores for segmentation
- customer_lifetime_value, churn_risk_score, propensity_scores, rfm_segments

**5. Reference Data** (optional, 1-2 files)
Catalog data specific to industry
- Airlines: routes, aircraft
- Retail: products, categories
- Banking: product_catalog
- Telco: plans, devices

### Step 3: Industry-Specific Customization

For each industry, think about:

**Product/Service Names**: Use realistic, industry-specific names
- Airlines: route names, fare classes (Economy Saver, Business Flex)
- Banking: product names (Premium Checking, Gold Credit Card, Home Loan)
- Telco: plan names (Unlimited Premium, Family Share 5GB)
- Retail: realistic product categories and SKUs
- Insurance: policy types (Auto Comprehensive, Term Life 20Y)
- Hotels: room types (Deluxe King, Executive Suite)

**Transaction Patterns**: Industry-realistic behaviors
- Airlines: booking windows (7-60 days advance), seasonal peaks, route preferences
- Banking: transaction frequencies, merchant categories, amounts
- Telco: usage patterns (peak hours, weekend spikes), recharge cycles
- Retail: shopping frequency, basket sizes, seasonal patterns

**Country Localization**: Adapt to the country
- Names: Use Faker library with country locale (Faker('vi_VN'), Faker('id_ID'), Faker('en_US'), Faker('ja_JP'))
- Addresses: Country-specific formats
- Phone numbers: Country codes and formats (+84 for Vietnam, +62 for Indonesia, etc.)
- Currency: Local currency codes (VND, IDR, USD, JPY, etc.)
- Language preferences: Based on country

### Step 4: Specify Data Volumes

Based on profiles and months, calculate realistic transaction volumes:

**Rule of thumb**:
- Retail: 3-8 transactions per customer per month
- Banking: 15-30 transactions per customer per month
- Telco: Daily usage records = ~30 per customer per month
- Airlines: 0.5-2 bookings per traveler per year
- Insurance: 0.1-0.5 claims per customer per year
- Hotels: 1-4 stays per customer per year

**Max limit**: 1.2M total transaction rows across all files

### Step 5: Provide Summary

Once you understand all requirements, provide a clear summary:

```
## Data Generation Plan

**Industry**: [Industry]
**Country**: [Country]
**Profiles**: [N] customers
**Time Period**: [M] months ([Start Date] to [End Date])

### Data Files to Generate:

1. **customer_profiles.csv** (~[N] rows)
   - Fields: customer_id, first_name, last_name, email, phone, address, city, region, country, age, gender, registration_date, segment, status

2. **[transaction_type].csv** (~[X] rows)
   - Fields: [specific fields for this industry]

3. **[another_transaction].csv** (~[Y] rows)
   - Fields: [specific fields]

4. **behavioral_events.csv** (~[Z] rows)
   - web_session_id, customer_id, event_type, timestamp, page_url, device_type, etc.

5. **customer_scores.csv** (~[N] rows)
   - customer_id, clv_score, churn_risk, segment, calculated_date

**Total Estimated Rows**: ~[Total] rows

### Industry-Specific Details:
- [Product/service names will be...]
- [Transaction patterns will reflect...]
- [Country localization: names will use [locale], phone format [format], currency [code]]

Ready to generate the Python script?
```

## IMPORTANT GUIDELINES

1. **Be Flexible**: Support ANY industry, even uncommon ones (logistics, agriculture, energy, government services, etc.)
2. **Adapt Product Names**: Generate realistic, industry-appropriate product/service names
3. **Localize Demographics**: Always use country-appropriate names, addresses, phone formats
4. **Realistic Volumes**: Keep total rows under 1.2M, distribute appropriately across files
5. **Industry Patterns**: Model realistic transaction patterns for the specific industry
6. **Ask Clarifying Questions**: If unsure about the SE's industry or requirements, ask specific questions

## RESPONSE STYLE

- Be conversational and helpful
- Show expertise in both data modeling and the industries you're helping with
- Provide specific examples relevant to their industry
- Confirm understanding before generating the script
"""

        # Build conversation messages
        messages = []

        # Add conversation history if provided
        if request.conversation_history:
            for msg in request.conversation_history:
                messages.append({
                    "role": msg.get("role", "user"),
                    "content": msg.get("content", "")
                })

        # Add current message
        messages.append({
            "role": "user",
            "content": request.message
        })

        response = await client.chat(
            messages=[{"role": "system", "content": system_prompt}] + messages,
            context=None,
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


@app.post("/api/data-generation/generate-script")
async def generate_data_script(request: GenerateScriptRequest):
    """Generate a complete Python data generation script package."""
    # Get LLM API key (prefer Anthropic for script generation)
    llm_api_key = (
        os.getenv("ANTHROPIC_API_KEY") or
        os.getenv("LLM_API_KEY") or
        os.getenv("OPENAI_API_KEY")
    )

    if not llm_api_key:
        raise HTTPException(status_code=400, detail="No LLM API key configured")

    try:
        # Read the airline example script as a template reference
        example_script_path = Path(__file__).parent.parent / "airline_data_model" / "generate_test_data.py"
        example_script = ""
        if example_script_path.exists():
            with open(example_script_path, 'r') as f:
                example_script = f.read()

        # Build generation prompt for Claude
        generation_prompt = f"""Generate a complete Python data generation script package for a Salesforce Data Cloud demo.

## Requirements

**Industry**: {request.industry}
**Country**: {request.country}
**Number of Profiles**: {request.profile_count}
**Historical Data Period**: {request.months_of_data} months
**Use Cases**: {request.use_cases}
{"**Additional Requirements**: " + request.additional_requirements if request.additional_requirements else ""}

## Your Task

Generate a complete, production-ready Python script that creates realistic demo data for this industry and country.

## Reference Example

Here's an example script for the airline industry (Vietnam). Use this as a structural reference, but ADAPT EVERYTHING to the {request.industry} industry and {request.country} country:

```python
{example_script[:15000]}  # First 15k chars for context
```

## Instructions

1. **Industry Adaptation**:
   - Replace ALL airline-specific concepts with {request.industry}-specific equivalents
   - Product/service names must be realistic for {request.industry}
   - Transaction types appropriate to {request.industry}
   - Reference data catalogs specific to {request.industry}

2. **Country Localization**:
   - Use Faker library with appropriate locale for {request.country}
   - Country-specific name generation
   - Realistic addresses for {request.country}
   - Correct phone number formats for {request.country}
   - Appropriate currency codes
   - Cultural context (holidays, preferences, patterns)

3. **Data Files to Generate**:
   Based on {request.industry}, create appropriate files:
   - 1 profile/entity file (customers, subscribers, patients, etc.)
   - 2-4 transaction files (purchases, bookings, claims, usage, etc.)
   - 1-2 behavioral/interaction files (web sessions, app events, searches)
   - 1 calculated metrics file (CLV, churn risk, segments)
   - Optional: 1-2 reference data files (products, plans, catalog)

4. **Data Volumes**:
   - {request.profile_count} profile records
   - {request.months_of_data} months of historical transactions
   - Total transaction rows should not exceed 1.2M
   - Distribute volumes realistically based on {request.industry} patterns

5. **Realistic Patterns**:
   - Transaction frequencies appropriate to {request.industry}
   - Seasonal variations if relevant
   - Realistic value distributions
   - Time-based patterns (weekday/weekend, business hours)

6. **Code Quality**:
   - Well-structured, readable code
   - Clear comments explaining industry-specific logic
   - Helper functions for reusability
   - Progress output during generation
   - CSV output with proper headers

## Output Format

Return a JSON object with the following structure:

```json
{{
  "files": [
    {{
      "path": "generate_data.py",
      "content": "# Complete Python script here..."
    }},
    {{
      "path": "requirements.txt",
      "content": "faker==22.0.0\\npython-dateutil==2.8.2\\n"
    }},
    {{
      "path": "README.md",
      "content": "# Markdown with setup instructions..."
    }},
    {{
      "path": "config_template.env",
      "content": "# AWS S3 Configuration\\nAWS_ACCESS_KEY_ID=your_key\\n..."
    }},
    {{
      "path": "upload_to_s3.py",
      "content": "# S3 upload script..."
    }},
    {{
      "path": "upload_to_snowflake.py",
      "content": "# Snowflake upload script..."
    }},
    {{
      "path": "upload_to_bigquery.py",
      "content": "# BigQuery upload script..."
    }}
  ],
  "metadata": {{
    "industry": "{request.industry}",
    "country": "{request.country}",
    "profile_count": {request.profile_count},
    "estimated_total_rows": 123456,
    "data_files": ["customer_profiles.csv", "transactions.csv", ...]
  }}
}}
```

## Critical Requirements

1. The generate_data.py script MUST be complete and runnable
2. Use Faker with correct locale for {request.country}
3. All product/service names must be {request.industry}-specific
4. Transaction patterns must reflect {request.industry} behavior
5. Include detailed README.md with setup instructions
6. Include cloud upload helper scripts (S3, Snowflake, BigQuery)
7. Return ONLY the JSON object, no markdown formatting around it

Generate the complete package now."""

        # Call Claude API directly for long-form generation
        async with httpx.AsyncClient(timeout=300.0) as http_client:
            response = await http_client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": llm_api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "claude-opus-4-5-20251101",
                    "max_tokens": 64000,
                    "temperature": 0.7,
                    "system": "You are an expert Python developer and data engineer specializing in generating realistic demo data for any industry. You understand data patterns, industry-specific behaviors, and cultural/geographic variations.",
                    "messages": [
                        {"role": "user", "content": generation_prompt}
                    ],
                },
            )
            response.raise_for_status()

            data = response.json()
            response_text = data["content"][0]["text"]

            # Parse JSON from response
            try:
                # Extract JSON from potential markdown blocks
                text = response_text.strip()
                if "```json" in text:
                    start = text.find("```json") + 7
                    end = text.find("```", start)
                    text = text[start:end].strip()
                elif "```" in text:
                    start = text.find("```") + 3
                    end = text.find("```", start)
                    text = text[start:end].strip()

                # Find JSON object boundaries
                start_idx = text.find("{")
                end_idx = text.rfind("}") + 1
                if start_idx >= 0 and end_idx > start_idx:
                    text = text[start_idx:end_idx]

                script_data = json.loads(text)

                return {
                    "success": True,
                    "files": script_data.get("files", []),
                    "metadata": script_data.get("metadata", {}),
                }
            except json.JSONDecodeError as e:
                return {
                    "success": False,
                    "error": f"Failed to parse generated script: {str(e)}",
                    "raw_response": response_text[:2000]
                }

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=f"LLM API error: {e.response.text}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Script generation failed: {str(e)}")


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


WEBSITE_BUILDER_SYSTEM_PROMPT = """You are a Website Builder Agent that helps Salesforce Solution Engineers create demo websites integrated with Salesforce Data Cloud, Agentforce, and Personalization.

## Your Role
Help SEs build compelling demo websites by gathering requirements through intelligent conversation. You should:
1. When a customer name is mentioned, use your knowledge to identify the company - their industry, headquarters location, and what they do
2. Proactively suggest the most appropriate industry template and use case based on the company
3. Ask clarifying questions only when truly needed
4. Guide the conversation efficiently toward building a great demo

## Company Identification
When the user mentions a company name:
- Identify if it's a well-known company and share what you know about them
- Determine their primary industry (airline, retail, banking, healthcare, telecom, or other)
- Identify their country/headquarters
- Suggest relevant use cases for their industry
- If the company name is ambiguous, ask for clarification

## Industry Templates Available
- **Airline**: Flight booking, loyalty programs, travel search, seat selection, check-in
- **Retail**: Product catalog, shopping cart, wishlist, order tracking, recommendations
- **Banking**: Account dashboard, transactions, loan applications, card services, investments
- **Healthcare**: Patient portal, appointments, prescriptions, health records, telehealth
- **Telecommunications**: Plan selection, device catalog, account management, support tickets

## Response Format
IMPORTANT: Always end your response with a JSON block containing any project details you've identified or confirmed. Format:

```json
{"project_updates": {"customer_name": "Company Name", "country": "Country", "industry": "industry_key", "use_case": "description", "ready_to_build": false}}
```

Rules for project_updates:
- Only include fields you're confident about
- industry must be one of: airline, retail, banking, healthcare, telecom, other
- Set ready_to_build to true ONLY when you have: customer_name, country, industry, and use_case confirmed
- If asking for clarification, don't include the uncertain field

## Conversation Style
- Be conversational and helpful, but efficient
- Use **bold** for important information
- When you identify a company, share a brief insight about them to show you understand their business
- Suggest specific use cases relevant to their industry
- Don't ask unnecessary questions if you can infer the answer

## Example Flow
User: "Vietnam Airlines"
Assistant: "**Vietnam Airlines** - Vietnam's national flag carrier! They're headquartered in Hanoi and are a member of SkyTeam alliance.

For an airline demo, I'd suggest focusing on the **flight booking journey** - capturing interactions from search through booking completion, including:
- Flight search and browsing
- Seat selection and upgrades
- Ancillary purchases (baggage, meals, lounge access)
- Loyalty program (Lotusmiles) integration
- Personalized offers based on travel history

Does this align with what you're looking to demonstrate? Or would you like to focus on a different aspect of their customer experience?

```json
{"project_updates": {"customer_name": "Vietnam Airlines", "country": "Vietnam", "industry": "airline", "use_case": null, "ready_to_build": false}}
```"

Remember: Your goal is to quickly understand what the SE needs and get them to a working demo website."""


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

            # Parse project_updates from JSON block in response
            project_updates = None
            import re
            json_match = re.search(r'```json\s*(\{[^`]+\})\s*```', assistant_response, re.DOTALL)
            if json_match:
                try:
                    json_data = json.loads(json_match.group(1))
                    project_updates = json_data.get("project_updates")
                    # Remove the JSON block from the display response
                    display_response = assistant_response[:json_match.start()].strip()
                except json.JSONDecodeError:
                    display_response = assistant_response
            else:
                display_response = assistant_response

            return WebsiteBuilderChatResponse(
                response=display_response,
                project_updates=project_updates
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
# FEEDBACK
# ============================================================================

# Marketing Cloud configuration (primary)
MC_CLIENT_ID = os.getenv("MC_CLIENT_ID")
MC_CLIENT_SECRET = os.getenv("MC_CLIENT_SECRET")
MC_AUTH_BASE_URI = os.getenv("MC_AUTH_BASE_URI")
MC_REST_BASE_URI = os.getenv("MC_REST_BASE_URI")
MC_TRIGGERED_SEND_ID = os.getenv("MC_TRIGGERED_SEND_ID")  # Triggered Send Definition External Key
MC_DE_EXTERNAL_KEY = os.getenv("MC_DE_EXTERNAL_KEY", "D360_Feedback_JB")  # Data Extension for Journey Builder
FEEDBACK_EMAIL_TO = os.getenv("FEEDBACK_EMAIL_TO", "mnarsana@salesforce.com")  # Default recipient

# SendGrid fallback
SENDGRID_API_KEY = os.getenv("SENDGRID_API_KEY")
FEEDBACK_EMAIL_FROM = os.getenv("FEEDBACK_EMAIL_FROM", "noreply@d360-assistant.com")

# Cache for MC access token
_mc_token_cache = {"token": None, "expires_at": 0}


class FeedbackRequest(BaseModel):
    page: str
    page_name: Optional[str] = None
    feedback_type: Optional[str] = "general"  # "bug", "enhancement", or "general"
    rating: Optional[str] = None  # "positive" or "negative"
    comment: Optional[str] = None
    email: Optional[str] = None  # User's email for follow-up


async def get_mc_access_token() -> Optional[str]:
    """Get Marketing Cloud access token (with caching)."""
    import time

    # Check cache
    if _mc_token_cache["token"] and time.time() < _mc_token_cache["expires_at"] - 60:
        return _mc_token_cache["token"]

    if not MC_CLIENT_ID or not MC_CLIENT_SECRET or not MC_AUTH_BASE_URI:
        return None

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{MC_AUTH_BASE_URI}/v2/token",
                json={
                    "grant_type": "client_credentials",
                    "client_id": MC_CLIENT_ID,
                    "client_secret": MC_CLIENT_SECRET,
                },
                timeout=15.0,
            )
            if response.status_code == 200:
                data = response.json()
                _mc_token_cache["token"] = data["access_token"]
                _mc_token_cache["expires_at"] = time.time() + data.get("expires_in", 1200)
                return data["access_token"]
            else:
                print(f"MC auth error: {response.status_code} - {response.text}")
                return None
    except Exception as e:
        print(f"MC auth exception: {e}")
        return None


async def send_feedback_to_de(feedback_entry: dict) -> bool:
    """Insert feedback record into Data Extension for Journey Builder.

    This is the preferred method - it inserts a row into a Data Extension
    which can be used as an entry source for a Journey in Journey Builder.
    """
    if not MC_REST_BASE_URI or not MC_DE_EXTERNAL_KEY:
        return False

    token = await get_mc_access_token()
    if not token:
        return False

    import uuid

    feedback_type = feedback_entry.get("feedback_type", "general")
    page_name = feedback_entry.get("page_name", feedback_entry.get("page", "Unknown"))
    comment = feedback_entry.get("comment", "No comment provided")
    user_email = feedback_entry.get("email", "Not provided")
    timestamp = feedback_entry.get("timestamp", datetime.utcnow().isoformat())
    rating = feedback_entry.get("rating", "")

    # Build subject line based on feedback type
    if feedback_type == "bug":
        subject = f"URGENT - BUG REPORTED: {page_name}"
        priority = "HIGH"
        feedback_type_label = "BUG"
    elif feedback_type == "enhancement":
        subject = f"Enhancement Request: {page_name}"
        priority = "MEDIUM"
        feedback_type_label = "ENHANCEMENT"
    else:
        subject = f"Feedback: {page_name}"
        priority = "LOW"
        feedback_type_label = "FEEDBACK"

    # Generate unique contact key for this feedback entry
    contact_key = f"feedback_{uuid.uuid4().hex[:12]}"

    # Data Extension row payload
    de_row = {
        "keys": {
            "ContactKey": contact_key
        },
        "values": {
            "ToEmailID": FEEDBACK_EMAIL_TO,
            "Subject": subject,
            "FeedbackType": feedback_type_label,
            "Priority": priority,
            "PageName": page_name,
            "Comment": comment[:4000] if comment else "",  # Truncate to field max length
            "UserEmail": user_email,
            "Timestamp": timestamp,
            "Rating": "Positive" if rating == "positive" else "Negative" if rating == "negative" else "N/A",
        }
    }

    try:
        async with httpx.AsyncClient() as client:
            # Insert row into Data Extension using REST API
            # POST /hub/v1/dataevents/key:{externalKey}/rowset
            response = await client.post(
                f"{MC_REST_BASE_URI}/hub/v1/dataevents/key:{MC_DE_EXTERNAL_KEY}/rowset",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=[de_row],
                timeout=15.0,
            )
            if response.status_code in (200, 201, 202):
                print(f"✓ Feedback inserted into DE '{MC_DE_EXTERNAL_KEY}' (ContactKey: {contact_key})")
                return True
            else:
                print(f"DE insert error: {response.status_code} - {response.text}")
                return False
    except Exception as e:
        print(f"DE insert exception: {e}")
        return False


async def send_feedback_via_mc(feedback_entry: dict) -> bool:
    """Send email notification via Marketing Cloud Triggered Send (legacy method)."""
    if not MC_REST_BASE_URI or not MC_TRIGGERED_SEND_ID or not FEEDBACK_EMAIL_TO:
        return False

    token = await get_mc_access_token()
    if not token:
        return False

    feedback_type = feedback_entry.get("feedback_type", "general")
    page_name = feedback_entry.get("page_name", feedback_entry.get("page", "Unknown"))
    comment = feedback_entry.get("comment", "No comment provided")
    user_email = feedback_entry.get("email", "Not provided")
    timestamp = feedback_entry.get("timestamp", "")
    rating = feedback_entry.get("rating", "")

    # Build subject line based on feedback type
    if feedback_type == "bug":
        subject = f"URGENT - BUG REPORTED: {page_name}"
        priority = "HIGH"
        feedback_type_label = "BUG"
    elif feedback_type == "enhancement":
        subject = f"Enhancement Request: {page_name}"
        priority = "MEDIUM"
        feedback_type_label = "ENHANCEMENT"
    else:
        subject = f"Feedback: {page_name}"
        priority = "LOW"
        feedback_type_label = "FEEDBACK"

    try:
        async with httpx.AsyncClient() as client:
            # Use Triggered Send API
            response = await client.post(
                f"{MC_REST_BASE_URI}/messaging/v1/messageDefinitionSends/key:{MC_TRIGGERED_SEND_ID}/send",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "To": {
                        "Address": FEEDBACK_EMAIL_TO,
                        "SubscriberKey": FEEDBACK_EMAIL_TO,
                        "ContactAttributes": {
                            "SubscriberAttributes": {
                                "Subject": subject,
                                "FeedbackType": feedback_type_label,
                                "Priority": priority,
                                "PageName": page_name,
                                "Comment": comment,
                                "UserEmail": user_email,
                                "Timestamp": timestamp,
                                "Rating": "Positive" if rating == "positive" else "Negative" if rating == "negative" else "N/A",
                            }
                        }
                    }
                },
                timeout=15.0,
            )
            if response.status_code in (200, 202):
                print(f"MC email sent successfully for {feedback_type} feedback")
                return True
            else:
                print(f"MC send error: {response.status_code} - {response.text}")
                return False
    except Exception as e:
        print(f"MC send exception: {e}")
        return False


async def send_feedback_via_sendgrid(feedback_entry: dict) -> bool:
    """Send email notification via SendGrid (fallback)."""
    if not SENDGRID_API_KEY or not FEEDBACK_EMAIL_TO:
        return False

    feedback_type = feedback_entry.get("feedback_type", "general")
    page_name = feedback_entry.get("page_name", feedback_entry.get("page", "Unknown"))
    comment = feedback_entry.get("comment", "No comment provided")
    user_email = feedback_entry.get("email", "Not provided")
    timestamp = feedback_entry.get("timestamp", "")
    rating = feedback_entry.get("rating", "")

    # Build subject line based on feedback type
    if feedback_type == "bug":
        subject = f"URGENT - BUG REPORTED: {page_name}"
        priority = "HIGH"
        emoji = "BUG"
    elif feedback_type == "enhancement":
        subject = f"Enhancement Request: {page_name}"
        priority = "MEDIUM"
        emoji = "ENHANCEMENT"
    else:
        subject = f"Feedback: {page_name}"
        priority = "LOW"
        emoji = "FEEDBACK"

    # Build email body
    html_content = f"""
    <html>
    <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: {'#fee2e2' if feedback_type == 'bug' else '#fef3c7' if feedback_type == 'enhancement' else '#dbeafe'}; padding: 20px; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; color: {'#991b1b' if feedback_type == 'bug' else '#92400e' if feedback_type == 'enhancement' else '#1e40af'};">
                {emoji}
            </h1>
            <p style="margin: 5px 0 0 0; color: #666;">Priority: {priority}</p>
        </div>

        <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
            <table style="width: 100%; border-collapse: collapse;">
                <tr>
                    <td style="padding: 8px 0; color: #666; width: 120px;">Page:</td>
                    <td style="padding: 8px 0; font-weight: bold;">{page_name}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666;">Submitted:</td>
                    <td style="padding: 8px 0;">{timestamp}</td>
                </tr>
                <tr>
                    <td style="padding: 8px 0; color: #666;">User Email:</td>
                    <td style="padding: 8px 0;">{user_email}</td>
                </tr>
                {f'<tr><td style="padding: 8px 0; color: #666;">Rating:</td><td style="padding: 8px 0;">{"Positive" if rating == "positive" else "Negative" if rating == "negative" else "N/A"}</td></tr>' if rating else ''}
            </table>

            <div style="margin-top: 20px; padding: 15px; background: #f9fafb; border-radius: 8px;">
                <h3 style="margin: 0 0 10px 0; color: #374151;">
                    {'Bug Description' if feedback_type == 'bug' else 'Enhancement Request' if feedback_type == 'enhancement' else 'Feedback'}
                </h3>
                <p style="margin: 0; white-space: pre-wrap; color: #1f2937;">{comment}</p>
            </div>
        </div>

        <div style="padding: 15px; text-align: center; color: #9ca3af; font-size: 12px;">
            <p>D360 Assistant Feedback System</p>
        </div>
    </body>
    </html>
    """

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={
                    "Authorization": f"Bearer {SENDGRID_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "personalizations": [{"to": [{"email": FEEDBACK_EMAIL_TO}]}],
                    "from": {"email": FEEDBACK_EMAIL_FROM, "name": "D360 Feedback"},
                    "subject": subject,
                    "content": [{"type": "text/html", "value": html_content}],
                },
                timeout=10.0,
            )
            if response.status_code in (200, 202):
                return True
            else:
                print(f"SendGrid error: {response.status_code} - {response.text}")
                return False
    except Exception as e:
        print(f"SendGrid exception: {e}")
        return False


async def send_feedback_email(feedback_entry: dict):
    """Send email notification - tries MC Data Extension (Journey Builder), then Triggered Send, then SendGrid."""
    # Try Marketing Cloud Data Extension first (preferred - triggers Journey Builder)
    if MC_CLIENT_ID and MC_REST_BASE_URI and MC_DE_EXTERNAL_KEY:
        success = await send_feedback_to_de(feedback_entry)
        if success:
            return
        print("MC Data Extension insert failed, trying Triggered Send...")

    # Try MC Triggered Send (legacy)
    if MC_CLIENT_ID and MC_REST_BASE_URI and MC_TRIGGERED_SEND_ID:
        success = await send_feedback_via_mc(feedback_entry)
        if success:
            return
        print("MC Triggered Send failed, trying SendGrid fallback...")

    # Fallback to SendGrid
    if SENDGRID_API_KEY:
        await send_feedback_via_sendgrid(feedback_entry)


@app.post("/api/feedback")
async def submit_feedback(request: FeedbackRequest):
    """Store user feedback and send email notification."""
    feedback_entry = {
        "page": request.page,
        "page_name": request.page_name,
        "feedback_type": request.feedback_type or "general",
        "rating": request.rating,
        "comment": request.comment,
        "email": request.email,
        "timestamp": datetime.utcnow().isoformat(),
    }

    # Store in Redis or memory
    if session_store._redis:
        try:
            session_store._redis.rpush(
                "dc_feedback",
                json.dumps(feedback_entry),
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        if not hasattr(session_store, '_feedback'):
            session_store._feedback = []
        session_store._feedback.append(feedback_entry)

    # Send email notification (async, don't block response)
    try:
        await send_feedback_email(feedback_entry)
    except Exception as e:
        # Log but don't fail the request
        print(f"Email notification failed: {e}")

    return {"success": True, "feedback_type": request.feedback_type}


@app.get("/api/feedback")
async def list_feedback():
    """List all feedback entries."""
    entries = []

    if session_store._redis:
        try:
            raw = session_store._redis.lrange("dc_feedback", 0, -1)
            entries = [json.loads(item) for item in raw]
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    else:
        entries = getattr(session_store, '_feedback', [])

    return {"feedback": entries, "count": len(entries)}


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
