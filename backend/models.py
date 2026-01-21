"""Pydantic models for Data Cloud SE Ingestion & Debugger."""

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class LLMProvider(str, Enum):
    """Supported LLM providers."""
    PERPLEXITY = "perplexity"
    OPENAI = "openai"
    ANTHROPIC = "anthropic"


class OAuthConfig(BaseModel):
    """OAuth configuration for Salesforce login."""
    login_url: str = Field(
        default="https://login.salesforce.com",
        description="Salesforce login base URL or My Domain URL"
    )
    client_id: str = Field(description="Connected App Client ID (Consumer Key)")
    redirect_uri: str = Field(
        default="http://localhost:8000/oauth/callback",
        description="OAuth redirect URI"
    )


class OAuthTokens(BaseModel):
    """OAuth tokens from Salesforce."""
    access_token: str
    refresh_token: Optional[str] = None
    instance_url: str
    token_type: str = "Bearer"
    issued_at: Optional[str] = None
    id_url: Optional[str] = None

    def redacted(self) -> dict:
        """Return a redacted version for display."""
        return {
            "access_token": f"{self.access_token[:10]}...REDACTED",
            "instance_url": self.instance_url,
            "token_type": self.token_type,
        }


class UserIdentity(BaseModel):
    """Salesforce user identity information."""
    user_id: str
    username: str
    display_name: Optional[str] = None
    organization_id: str
    email: Optional[str] = None


class DataCloudConfig(BaseModel):
    """Configuration for Data Cloud API endpoints."""
    # Token exchange
    a360_token_endpoint_path: str = Field(
        default="/services/a360/token",
        description="A360 token endpoint path"
    )
    audience: Optional[str] = Field(
        default=None,
        description="Audience/tenant identifier if needed"
    )

    # Ingestion API
    ingestion_api_base_url: Optional[str] = Field(
        default=None,
        description="Ingestion API base URL"
    )
    ingestion_endpoint_path_template: str = Field(
        default="/api/v1/ingest/sources/{sourceApiName}/streams/{streamApiName}",
        description="Ingestion event endpoint path template"
    )
    ingestion_extra_headers: dict[str, str] = Field(
        default_factory=dict,
        description="Additional headers for ingestion API"
    )
    ingestion_extra_params: dict[str, str] = Field(
        default_factory=dict,
        description="Additional query params for ingestion API"
    )

    # Data Graph / Profile retrieval
    query_base_url: Optional[str] = Field(
        default=None,
        description="Data Cloud query base URL"
    )
    data_graph_endpoint_template: str = Field(
        default="/api/v1/dataGraph/{dataGraphName}/{recordId}",
        description="Data Graph endpoint path template"
    )
    profile_endpoint_template: str = Field(
        default="/api/v1/profile/{dataModelName}/{recordId}",
        description="Profile endpoint path template"
    )
    retrieval_extra_headers: dict[str, str] = Field(
        default_factory=dict,
        description="Additional headers for retrieval API"
    )
    retrieval_extra_params: dict[str, str] = Field(
        default_factory=dict,
        description="Additional query params for retrieval API"
    )


class DataCloudToken(BaseModel):
    """Data Cloud (A360) token."""
    access_token: str
    token_type: str = "Bearer"
    expires_in: Optional[int] = None
    instance_url: Optional[str] = None

    def redacted(self) -> dict:
        """Return a redacted version for display."""
        return {
            "access_token": f"{self.access_token[:10]}...REDACTED",
            "token_type": self.token_type,
            "instance_url": self.instance_url,
        }


class StreamTarget(BaseModel):
    """A saved stream target configuration."""
    name: str = Field(description="Stream name (label)")
    endpoint_path: str = Field(description="Target ingestion endpoint path or full URL")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FieldType(str, Enum):
    """Supported field types in schema."""
    STRING = "string"
    INTEGER = "integer"
    NUMBER = "number"
    BOOLEAN = "boolean"
    DATE = "date"
    DATETIME = "datetime"
    OBJECT = "object"
    ARRAY = "array"


class SchemaField(BaseModel):
    """Normalized schema field definition."""
    field_name: str
    field_type: FieldType
    required: bool = False
    is_primary_key: bool = False
    enum_values: Optional[list[str]] = None
    format: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    pattern: Optional[str] = None
    description: Optional[str] = None
    nested_schema: Optional[list["SchemaField"]] = None


class GeneratorType(str, Enum):
    """Types of deterministic generators."""
    UUID4 = "uuid4"
    TIMESTAMP_ISO8601 = "timestamp_iso8601"
    DATE_ISO8601 = "date_iso8601"
    ENUM_CHOICE = "enum_choice"
    INT_RANGE = "int_range"
    NUMERIC_RANGE = "numeric_range"
    EMAIL = "email"
    PHONE_E164 = "phone_e164"
    STRING = "string"
    STRING_PATTERN = "string_pattern"
    COUNTRY = "country"
    CITY = "city"
    LAT_LONG = "lat_long"
    FIXED_VALUE = "fixed_value"
    BOOLEAN = "boolean"
    FIRST_NAME = "first_name"
    LAST_NAME = "last_name"
    FULL_NAME = "full_name"
    ADDRESS = "address"
    COMPANY = "company"
    URL = "url"
    CURRENCY = "currency"


class FieldGenerationPlan(BaseModel):
    """Generation plan for a single field."""
    field_name: str
    generator_type: GeneratorType
    suggested_value: Optional[Any] = None
    constraints: dict[str, Any] = Field(default_factory=dict)
    rationale: Optional[str] = None


class GenerationPlan(BaseModel):
    """Complete generation plan for all fields."""
    fields: list[FieldGenerationPlan]
    use_case: str
    seed: Optional[int] = None


class IngestionEvent(BaseModel):
    """A single ingestion event record."""
    payload: dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    target: str
    status_code: Optional[int] = None
    response_body: Optional[str] = None
    correlation_id: Optional[str] = None


class RetrievalType(str, Enum):
    """Type of data retrieval."""
    DATA_GRAPH = "data_graph"
    PROFILE = "profile"


class RetrievalRequest(BaseModel):
    """Request for data retrieval."""
    retrieval_type: RetrievalType
    endpoint_path: str
    identifier: str = Field(description="Profile ID or subject ID")
    query: Optional[str] = None  # For GraphQL queries


class RetrievalResult(BaseModel):
    """Result from data retrieval."""
    data: dict[str, Any]
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    retrieval_type: RetrievalType
    identifier: str


class DataStreamObject(BaseModel):
    """An object/entity within a data stream."""
    name: str
    api_name: str
    attribute_count: Optional[int] = None
    endpoint_path: Optional[str] = None


class DataStream(BaseModel):
    """A Data Cloud data stream (Ingestion API source)."""
    id: Optional[str] = None
    name: str
    api_name: str
    connector_type: Optional[str] = None  # e.g., "Ingestion API"
    status: Optional[str] = None  # e.g., "In Use", "Not In Use"
    last_updated: Optional[str] = None
    objects: list[DataStreamObject] = Field(default_factory=list)
    raw_data: Optional[dict] = None  # Store full API response for debugging


class AppConfig(BaseModel):
    """Exportable application configuration (without secrets)."""
    model_config = ConfigDict(
        json_encoders={datetime: lambda v: v.isoformat()}
    )

    oauth_config: Optional[OAuthConfig] = None
    data_cloud_config: Optional[DataCloudConfig] = None
    stream_targets: list[StreamTarget] = Field(default_factory=list)
