"""Data Cloud API client for token exchange, ingestion, and retrieval."""

import json
from typing import Any, Optional
from urllib.parse import urljoin

import httpx

from models import (
    DataCloudConfig,
    DataCloudToken,
    DataStream,
    DataStreamObject,
    IngestionEvent,
    OAuthTokens,
    RetrievalRequest,
    RetrievalResult,
    RetrievalType,
)


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


class DataCloudClient:
    """Client for interacting with Salesforce Data Cloud APIs."""

    def __init__(
        self,
        config: DataCloudConfig,
        sf_tokens: OAuthTokens,
        dc_token: Optional[DataCloudToken] = None
    ):
        """Initialize the Data Cloud client.

        Args:
            config: Data Cloud configuration
            sf_tokens: Salesforce OAuth tokens
            dc_token: Optional Data Cloud token (if already exchanged)
        """
        self.config = config
        self.sf_tokens = sf_tokens
        self.dc_token = dc_token
        self._http_client = httpx.AsyncClient(timeout=60.0)

    async def close(self):
        """Close the HTTP client."""
        await self._http_client.aclose()

    async def exchange_for_data_cloud_token(self) -> DataCloudToken:
        """Exchange Salesforce token for Data Cloud (A360) token.

        Returns:
            Data Cloud token

        Raises:
            httpx.HTTPStatusError: If token exchange fails
        """
        # Build the token exchange URL
        base_url = _ensure_https(self.sf_tokens.instance_url).rstrip('/')
        token_endpoint = f"{base_url}{self.config.a360_token_endpoint_path}"

        headers = {
            "Authorization": f"{self.sf_tokens.token_type} {self.sf_tokens.access_token}",
            "Content-Type": "application/x-www-form-urlencoded",
        }

        # Build the request body - requires subject_token parameters
        data = {
            "grant_type": "urn:salesforce:grant-type:external:cdp",
            "subject_token": self.sf_tokens.access_token,
            "subject_token_type": "urn:ietf:params:oauth:token-type:access_token",
        }

        # Add audience if configured
        if self.config.audience:
            data["audience"] = self.config.audience

        response = await self._http_client.post(
            token_endpoint,
            data=data,
            headers=headers
        )

        # Get response body for error details
        try:
            token_data = response.json()
        except Exception:
            token_data = {"raw_response": response.text}

        if response.status_code != 200:
            error_msg = token_data.get("error", "Unknown error")
            error_desc = token_data.get("error_description", str(token_data))
            raise ValueError(f"Data Cloud token exchange failed ({response.status_code}): {error_msg} - {error_desc}")

        # Check for required fields
        if "access_token" not in token_data:
            raise ValueError(f"Data Cloud token response missing access_token. Response: {token_data}")

        self.dc_token = DataCloudToken(
            access_token=token_data["access_token"],
            token_type=token_data.get("token_type", "Bearer"),
            expires_in=token_data.get("expires_in"),
            instance_url=token_data.get("instance_url"),
        )

        return self.dc_token

    async def list_data_streams(self, use_dc_token: bool = True) -> list[DataStream]:
        """List all data streams (Ingestion API sources) from Data Cloud.

        Args:
            use_dc_token: Whether to use Data Cloud token

        Returns:
            List of DataStream objects

        Raises:
            ValueError: If API call fails
        """
        streams = []
        errors = []

        # Try multiple base URLs - some APIs are on SF instance, some on DC instance
        base_urls_to_try = []

        # Data Cloud instance URL
        dc_base = self._get_base_url(use_dc_token=True)
        if dc_base:
            base_urls_to_try.append(("DC", dc_base))

        # Salesforce instance URL (metadata APIs often live here)
        sf_base = self._get_base_url(use_dc_token=False)
        if sf_base and sf_base != dc_base:
            base_urls_to_try.append(("SF", sf_base))

        # Endpoints to try on each base URL
        endpoints_to_try = [
            # Data 360 Connect API - correct endpoint from documentation
            "/services/data/v62.0/ssot/data-streams",
            "/services/data/v61.0/ssot/data-streams",
            "/services/data/v60.0/ssot/data-streams",
            # Alternative SSOT endpoints
            "/services/data/v62.0/ssot/ingest-connectors",
            "/services/data/v62.0/ssot/data-connectors",
            # Connect API paths
            "/services/data/v62.0/connect/data-streams",
            "/services/data/v62.0/connect/cdp/data-streams",
        ]

        for base_name, base_url in base_urls_to_try:
            headers = self._get_auth_headers(use_dc_token=(base_name == "DC"))
            headers["Accept"] = "application/json"

            for endpoint in endpoints_to_try:
                url = f"{base_url}{endpoint}"
                try:
                    response = await self._http_client.get(url, headers=headers)
                    if response.status_code == 200:
                        data = response.json()
                        streams = self._parse_data_streams_response(data, endpoint)
                        if streams:
                            return streams
                        else:
                            errors.append(f"[{base_name}] {endpoint}: Empty response")
                    elif response.status_code == 404:
                        errors.append(f"[{base_name}] {endpoint}: 404")
                    elif response.status_code == 400:
                        # Bad request might mean invalid SOQL - skip silently
                        pass
                    else:
                        errors.append(f"[{base_name}] {endpoint}: HTTP {response.status_code}")
                except Exception as e:
                    errors.append(f"[{base_name}] {endpoint}: {str(e)}")

        # If no endpoint worked, raise an error with details
        raise ValueError(
            f"Could not fetch data streams. Tried {len(errors)} endpoints. "
            "The Data Streams discovery API may not be available. Please use Manual Entry tab instead."
        )

    def _parse_data_streams_response(self, data: dict, endpoint: str) -> list[DataStream]:
        """Parse the data streams response from various API formats.

        Args:
            data: Raw API response
            endpoint: The endpoint that was called (helps determine parsing strategy)

        Returns:
            List of DataStream objects
        """
        streams = []

        # Handle different response formats
        records = []
        if isinstance(data, list):
            records = data
        elif isinstance(data, dict):
            # Try common keys for list of records
            records = (
                data.get("records") or
                data.get("data") or
                data.get("sources") or
                data.get("ingestApiSources") or
                data.get("result") or
                []
            )
            if not isinstance(records, list):
                records = [data] if data else []

        for record in records:
            if not isinstance(record, dict):
                continue

            # Extract stream info - handle various field naming conventions
            stream = DataStream(
                id=record.get("id") or record.get("Id") or record.get("sourceId"),
                name=(
                    record.get("name") or
                    record.get("Name") or
                    record.get("connectorName") or
                    record.get("sourceName") or
                    "Unknown"
                ),
                api_name=(
                    record.get("apiName") or
                    record.get("sourceApiName") or
                    record.get("developerName") or
                    record.get("DeveloperName") or
                    record.get("name") or
                    "Unknown"
                ),
                connector_type=(
                    record.get("connectorType") or
                    record.get("type") or
                    record.get("sourceType") or
                    "Ingestion API"
                ),
                status=record.get("status") or record.get("connectorStatus"),
                last_updated=record.get("lastUpdated") or record.get("lastModifiedDate"),
                objects=self._parse_stream_objects(record),
                raw_data=record,
            )
            streams.append(stream)

        return streams

    def _parse_stream_objects(self, stream_record: dict) -> list[DataStreamObject]:
        """Parse objects/entities within a stream record.

        Args:
            stream_record: A single stream record from the API

        Returns:
            List of DataStreamObject
        """
        objects = []

        # Try to find objects/entities in the record
        obj_list = (
            stream_record.get("objects") or
            stream_record.get("entities") or
            stream_record.get("schema") or
            stream_record.get("dataObjects") or
            []
        )

        if isinstance(obj_list, list):
            for obj in obj_list:
                if isinstance(obj, dict):
                    api_name = (
                        obj.get("apiName") or
                        obj.get("objectApiName") or
                        obj.get("name") or
                        "Unknown"
                    )
                    source_api_name = stream_record.get("apiName") or stream_record.get("sourceApiName") or ""

                    objects.append(DataStreamObject(
                        name=obj.get("name") or obj.get("objectName") or api_name,
                        api_name=api_name,
                        attribute_count=obj.get("attributeCount") or obj.get("numberOfAttributes"),
                        endpoint_path=f"/api/v1/ingest/sources/{source_api_name}/{api_name}" if source_api_name else None,
                    ))

        return objects

    async def get_data_stream_details(
        self,
        source_api_name: str,
        use_dc_token: bool = True
    ) -> DataStream:
        """Get detailed information about a specific data stream.

        Args:
            source_api_name: The API name of the ingestion source
            use_dc_token: Whether to use Data Cloud token

        Returns:
            DataStream with full details including objects

        Raises:
            ValueError: If API call fails
        """
        base_url = self._get_base_url(use_dc_token)
        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        endpoints_to_try = [
            f"/services/data/v62.0/ssot/ingest-api-sources/{source_api_name}",
            f"/api/v1/ingest/sources/{source_api_name}",
        ]

        for endpoint in endpoints_to_try:
            url = f"{base_url}{endpoint}"
            try:
                response = await self._http_client.get(url, headers=headers)
                if response.status_code == 200:
                    data = response.json()
                    streams = self._parse_data_streams_response(data if isinstance(data, list) else [data], endpoint)
                    if streams:
                        return streams[0]
            except Exception:
                continue

        raise ValueError(f"Could not fetch details for data stream: {source_api_name}")

    def _get_base_url(self, use_dc_token: bool = True) -> str:
        """Get the base URL for API calls.

        Args:
            use_dc_token: Whether to prefer Data Cloud instance URL

        Returns:
            Base URL string with https:// prefix
        """
        if use_dc_token and self.dc_token and self.dc_token.instance_url:
            url = self.dc_token.instance_url
        else:
            url = self.sf_tokens.instance_url

        return _ensure_https(url).rstrip('/') if url else ""

    def _get_auth_headers(self, use_dc_token: bool = True) -> dict[str, str]:
        """Get authorization headers.

        Args:
            use_dc_token: Whether to use Data Cloud token (True) or SF token (False)

        Returns:
            Headers dict with Authorization
        """
        if use_dc_token and self.dc_token:
            return {
                "Authorization": f"{self.dc_token.token_type} {self.dc_token.access_token}"
            }
        return {
            "Authorization": f"{self.sf_tokens.token_type} {self.sf_tokens.access_token}"
        }

    def build_ingestion_url(self, endpoint_path: str) -> str:
        """Build the full ingestion URL.

        Args:
            endpoint_path: The endpoint path or full URL

        Returns:
            Full URL for ingestion
        """
        # If it's already a full URL, return as-is
        if endpoint_path and (endpoint_path.startswith("http://") or endpoint_path.startswith("https://")):
            return endpoint_path

        # Use configured base URL or Data Cloud instance URL or SF instance URL
        if self.config.ingestion_api_base_url:
            base_url = _ensure_https(self.config.ingestion_api_base_url)
        elif self.dc_token and self.dc_token.instance_url:
            base_url = _ensure_https(self.dc_token.instance_url)
        else:
            base_url = _ensure_https(self.sf_tokens.instance_url)

        base_url = base_url.rstrip('/') if base_url else ""

        # Ensure endpoint_path starts with /
        if not endpoint_path.startswith('/'):
            endpoint_path = '/' + endpoint_path

        return f"{base_url}{endpoint_path}"

    async def send_ingestion_event(
        self,
        endpoint_path: str,
        payload: dict[str, Any],
        use_dc_token: bool = True
    ) -> IngestionEvent:
        """Send an event to the Data Cloud Ingestion API.

        Args:
            endpoint_path: The endpoint path or full URL
            payload: The event payload to send
            use_dc_token: Whether to use Data Cloud token

        Returns:
            IngestionEvent with response details

        Raises:
            httpx.HTTPStatusError: If ingestion fails
        """
        url = self.build_ingestion_url(endpoint_path)

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"

        # Add any extra configured headers
        headers.update(self.config.ingestion_extra_headers)

        # Build query params
        params = dict(self.config.ingestion_extra_params)

        try:
            response = await self._http_client.post(
                url,
                json={"data": [payload]},  # Wrap in data array per API spec
                headers=headers,
                params=params if params else None
            )

            event = IngestionEvent(
                payload=payload,
                target=url,
                status_code=response.status_code,
                response_body=response.text,
            )

            # Try to extract correlation ID from response
            try:
                response_json = response.json()
                event.correlation_id = response_json.get("correlationId") or response_json.get("id")
            except json.JSONDecodeError:
                pass

            response.raise_for_status()
            return event

        except httpx.HTTPStatusError as e:
            event = IngestionEvent(
                payload=payload,
                target=url,
                status_code=e.response.status_code,
                response_body=e.response.text,
            )
            raise

    async def test_ingestion_endpoint(
        self,
        endpoint_path: str,
        use_dc_token: bool = True
    ) -> tuple[bool, str]:
        """Test the ingestion endpoint with a lightweight request.

        Args:
            endpoint_path: The endpoint path or full URL
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Tuple of (success: bool, message: str)
        """
        url = self.build_ingestion_url(endpoint_path)

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"
        headers.update(self.config.ingestion_extra_headers)

        params = dict(self.config.ingestion_extra_params)

        try:
            # Try OPTIONS request first (lightweight)
            response = await self._http_client.options(
                url,
                headers=headers,
                params=params if params else None
            )

            if response.status_code in (200, 204, 405):
                # 405 means endpoint exists but doesn't support OPTIONS
                return True, f"Endpoint reachable: {url}"

            return False, f"Endpoint returned status {response.status_code}: {response.text}"

        except httpx.HTTPStatusError as e:
            return False, f"HTTP error {e.response.status_code}: {e.response.text}"
        except httpx.RequestError as e:
            return False, f"Connection error: {str(e)}"
        except Exception as e:
            return False, f"Error: {str(e)}"

    def build_retrieval_url(
        self,
        retrieval_type: RetrievalType,
        endpoint_path: str
    ) -> str:
        """Build the full retrieval URL.

        Args:
            retrieval_type: Type of retrieval (data_graph or profile)
            endpoint_path: The endpoint path or full URL

        Returns:
            Full URL for retrieval
        """
        # If it's already a full URL, return as-is
        if endpoint_path and (endpoint_path.startswith("http://") or endpoint_path.startswith("https://")):
            return endpoint_path

        # Use configured base URL or Data Cloud instance URL or SF instance URL
        if self.config.query_base_url:
            base_url = _ensure_https(self.config.query_base_url)
        elif self.dc_token and self.dc_token.instance_url:
            base_url = _ensure_https(self.dc_token.instance_url)
        else:
            base_url = _ensure_https(self.sf_tokens.instance_url)

        base_url = base_url.rstrip('/') if base_url else ""

        # Ensure endpoint_path starts with /
        if endpoint_path and not endpoint_path.startswith('/'):
            endpoint_path = '/' + endpoint_path

        return f"{base_url}{endpoint_path}"

    async def retrieve_data(
        self,
        request: RetrievalRequest,
        use_dc_token: bool = True
    ) -> RetrievalResult:
        """Retrieve data from Data Cloud (Data Graph or Profile).

        Args:
            request: The retrieval request
            use_dc_token: Whether to use Data Cloud token

        Returns:
            RetrievalResult with the fetched data

        Raises:
            httpx.HTTPStatusError: If retrieval fails
        """
        url = self.build_retrieval_url(request.retrieval_type, request.endpoint_path)

        headers = self._get_auth_headers(use_dc_token)
        headers.update(self.config.retrieval_extra_headers)

        params = dict(self.config.retrieval_extra_params)

        headers["Accept"] = "application/json"

        if request.retrieval_type == RetrievalType.DATA_GRAPH:
            if request.query:
                # Data Graph with custom query uses POST
                headers["Content-Type"] = "application/json"
                response = await self._http_client.post(
                    url,
                    json={"query": request.query},
                    headers=headers,
                    params=params if params else None
                )
            else:
                # Data Graph by ID uses GET: /api/v1/dataGraph/{graphName}/{recordId}
                response = await self._http_client.get(
                    url,
                    headers=headers,
                    params=params if params else None
                )
        else:
            # Profile uses GET: /api/v1/profile/{dataModelName}/{recordId}
            response = await self._http_client.get(
                url,
                headers=headers,
                params=params if params else None
            )

        response.raise_for_status()

        return RetrievalResult(
            data=response.json(),
            retrieval_type=request.retrieval_type,
            identifier=request.identifier,
        )

    async def test_retrieval_endpoint(
        self,
        retrieval_type: RetrievalType,
        endpoint_path: str,
        use_dc_token: bool = True
    ) -> tuple[bool, str]:
        """Test the retrieval endpoint with a lightweight request.

        Args:
            retrieval_type: Type of retrieval
            endpoint_path: The endpoint path or full URL
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Tuple of (success: bool, message: str)
        """
        url = self.build_retrieval_url(retrieval_type, endpoint_path)

        headers = self._get_auth_headers(use_dc_token)
        headers.update(self.config.retrieval_extra_headers)

        try:
            # Try OPTIONS request
            response = await self._http_client.options(url, headers=headers)

            if response.status_code in (200, 204, 405):
                return True, f"Endpoint reachable: {url}"

            return False, f"Endpoint returned status {response.status_code}: {response.text}"

        except httpx.HTTPStatusError as e:
            return False, f"HTTP error {e.response.status_code}: {e.response.text}"
        except httpx.RequestError as e:
            return False, f"Connection error: {str(e)}"
        except Exception as e:
            return False, f"Error: {str(e)}"


    # =========================================================================
    # QUERY API
    # =========================================================================

    async def execute_query(
        self,
        sql: str,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Execute a SQL query against Data Cloud.

        Args:
            sql: SQL query string (Data Cloud SQL syntax)
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Query results as dict with 'data' and 'metadata' keys

        Raises:
            httpx.HTTPStatusError: If query fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/query"

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        response = await self._http_client.post(
            url,
            json={"sql": sql},
            headers=headers,
        )

        response.raise_for_status()
        return response.json()

    # =========================================================================
    # METADATA API
    # =========================================================================

    async def get_metadata(
        self,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Get metadata about all entities in Data Cloud.

        Returns metadata about Calculated Insights, Engagement, Profile,
        Data Lake Objects, Data Model Objects, and their relationships.

        Args:
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Metadata dict with entity information

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/metadata"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        response = await self._http_client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    # =========================================================================
    # PROFILE API
    # =========================================================================

    async def get_profile_metadata(
        self,
        data_model_name: Optional[str] = None,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Get metadata for profile data model objects.

        Args:
            data_model_name: Optional specific data model to get metadata for.
                           If None, returns metadata for all profile objects.
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Profile metadata dict

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)

        if data_model_name:
            url = f"{base_url}/api/v1/profile/metadata/{data_model_name}"
        else:
            url = f"{base_url}/api/v1/profile/metadata"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        response = await self._http_client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    async def query_profiles(
        self,
        data_model_name: str,
        filters: Optional[dict[str, Any]] = None,
        fields: Optional[list[str]] = None,
        limit: int = 100,
        offset: int = 0,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Query profile records from a data model object.

        Args:
            data_model_name: Name of the data model object to query
            filters: Optional filter conditions
            fields: Optional list of fields to return
            limit: Maximum number of records to return (default 100)
            offset: Number of records to skip (for pagination)
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Query results with profile records

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/profile/{data_model_name}"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        params = {
            "limit": limit,
            "offset": offset,
        }

        if fields:
            params["fields"] = ",".join(fields)

        if filters:
            # Convert filters to query string format
            for key, value in filters.items():
                params[key] = value

        response = await self._http_client.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()

    async def get_profile_by_id(
        self,
        data_model_name: str,
        record_id: str,
        fields: Optional[list[str]] = None,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Get a specific profile record by ID.

        Args:
            data_model_name: Name of the data model object
            record_id: The unique identifier of the record
            fields: Optional list of fields to return
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Profile record data

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/profile/{data_model_name}/{record_id}"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        params = {}
        if fields:
            params["fields"] = ",".join(fields)

        response = await self._http_client.get(
            url,
            headers=headers,
            params=params if params else None
        )
        response.raise_for_status()
        return response.json()

    # =========================================================================
    # CALCULATED INSIGHTS API
    # =========================================================================

    async def get_insights_metadata(
        self,
        insight_name: Optional[str] = None,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Get metadata for calculated insights.

        Args:
            insight_name: Optional specific insight to get metadata for.
                        If None, returns metadata for all insights.
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Insights metadata dict with dimensions and measures

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)

        if insight_name:
            url = f"{base_url}/api/v1/insight/metadata/{insight_name}"
        else:
            url = f"{base_url}/api/v1/insight/metadata"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        response = await self._http_client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    async def query_calculated_insight(
        self,
        insight_name: str,
        dimensions: Optional[list[str]] = None,
        measures: Optional[list[str]] = None,
        filters: Optional[list[dict[str, Any]]] = None,
        limit: int = 100,
        offset: int = 0,
        order_by: Optional[list[dict[str, str]]] = None,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Query a calculated insight.

        Args:
            insight_name: Name of the calculated insight
            dimensions: List of dimension names to include
            measures: List of measure names to include
            filters: Optional list of filter objects
            limit: Maximum rows to return (default 100, max 4999)
            offset: Number of rows to skip
            order_by: Optional list of order specifications
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Insight query results

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/insight/calculated-insights/{insight_name}"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        params = {
            "limit": min(limit, 4999),  # API max is 4999
            "offset": offset,
        }

        if dimensions:
            params["dimensions"] = ",".join(dimensions)

        if measures:
            params["measures"] = ",".join(measures)

        if filters:
            params["filters"] = json.dumps(filters)

        if order_by:
            params["orderBy"] = json.dumps(order_by)

        response = await self._http_client.get(url, headers=headers, params=params)
        response.raise_for_status()
        return response.json()

    # =========================================================================
    # BULK INGESTION API
    # =========================================================================

    async def create_bulk_job(
        self,
        source_name: str,
        object_name: str,
        operation: str = "upsert",
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Create a bulk ingestion job.

        Args:
            source_name: Name of the ingestion source
            object_name: Name of the object to ingest to
            operation: Operation type: 'upsert' or 'delete'
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Job creation response with job ID

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/jobs"

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        body = {
            "sourceName": source_name,
            "objectName": object_name,
            "operation": operation,
        }

        response = await self._http_client.post(url, json=body, headers=headers)
        response.raise_for_status()
        return response.json()

    async def upload_bulk_data(
        self,
        job_id: str,
        csv_data: str,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Upload CSV data to a bulk job.

        Args:
            job_id: The bulk job ID
            csv_data: CSV formatted string data
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Upload response

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/jobs/{job_id}/batches"

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "text/csv"
        headers["Accept"] = "application/json"

        response = await self._http_client.put(
            url,
            content=csv_data,
            headers=headers
        )
        response.raise_for_status()

        # Response may be empty on success
        if response.text:
            return response.json()
        return {"status": "uploaded"}

    async def close_bulk_job(
        self,
        job_id: str,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Close a bulk job and queue it for processing.

        Args:
            job_id: The bulk job ID
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Job status response

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/jobs/{job_id}"

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        response = await self._http_client.patch(
            url,
            json={"state": "UploadComplete"},
            headers=headers
        )
        response.raise_for_status()
        return response.json()

    async def abort_bulk_job(
        self,
        job_id: str,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Abort a bulk job.

        Args:
            job_id: The bulk job ID
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Job status response

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/jobs/{job_id}"

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        response = await self._http_client.patch(
            url,
            json={"state": "Aborted"},
            headers=headers
        )
        response.raise_for_status()
        return response.json()

    async def get_bulk_job_status(
        self,
        job_id: str,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Get the status of a bulk job.

        Args:
            job_id: The bulk job ID
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Job status response

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/jobs/{job_id}"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        response = await self._http_client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    async def list_bulk_jobs(
        self,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """List all bulk ingestion jobs.

        Args:
            use_dc_token: Whether to use Data Cloud token

        Returns:
            List of bulk jobs

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/jobs"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        response = await self._http_client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    async def delete_bulk_job(
        self,
        job_id: str,
        use_dc_token: bool = True
    ) -> bool:
        """Delete a bulk job.

        Args:
            job_id: The bulk job ID
            use_dc_token: Whether to use Data Cloud token

        Returns:
            True if deleted successfully

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/jobs/{job_id}"

        headers = self._get_auth_headers(use_dc_token)

        response = await self._http_client.delete(url, headers=headers)
        response.raise_for_status()
        return True

    # =========================================================================
    # DATA GRAPHS API (Enhanced)
    # =========================================================================

    async def get_data_graphs_metadata(
        self,
        graph_name: Optional[str] = None,
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Get metadata for data graphs.

        Args:
            graph_name: Optional specific graph to get metadata for.
                       If None, returns metadata for all graphs.
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Data graph metadata

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)

        if graph_name:
            url = f"{base_url}/api/v1/dataGraph/metadata/{graph_name}"
        else:
            url = f"{base_url}/api/v1/dataGraph/metadata"

        headers = self._get_auth_headers(use_dc_token)
        headers["Accept"] = "application/json"

        response = await self._http_client.get(url, headers=headers)
        response.raise_for_status()
        return response.json()

    async def query_data_graph(
        self,
        graph_name: str,
        query_filters: dict[str, Any],
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Query a data graph with filters.

        Args:
            graph_name: Name of the data graph
            query_filters: Query filter object
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Query results

        Raises:
            httpx.HTTPStatusError: If request fails
        """
        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/dataGraph/{graph_name}/query"

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        response = await self._http_client.post(
            url,
            json=query_filters,
            headers=headers
        )
        response.raise_for_status()
        return response.json()

    # =========================================================================
    # DELETE RECORDS (Streaming)
    # =========================================================================

    async def delete_records(
        self,
        source_name: str,
        object_name: str,
        record_ids: list[str],
        id_field_name: str = "id",
        use_dc_token: bool = True
    ) -> dict[str, Any]:
        """Delete records from Data Cloud via streaming API.

        Args:
            source_name: Name of the ingestion source
            object_name: Name of the object
            record_ids: List of record IDs to delete (max 200)
            id_field_name: Name of the ID field
            use_dc_token: Whether to use Data Cloud token

        Returns:
            Deletion response

        Raises:
            httpx.HTTPStatusError: If request fails
            ValueError: If more than 200 record IDs provided
        """
        if len(record_ids) > 200:
            raise ValueError("Maximum 200 records can be deleted per request")

        base_url = self._get_base_url(use_dc_token)
        url = f"{base_url}/api/v1/ingest/sources/{source_name}/{object_name}"

        headers = self._get_auth_headers(use_dc_token)
        headers["Content-Type"] = "application/json"
        headers["Accept"] = "application/json"

        # Build delete payload
        delete_data = [
            {id_field_name: record_id}
            for record_id in record_ids
        ]

        response = await self._http_client.request(
            "DELETE",
            url,
            json={"data": delete_data},
            headers=headers
        )
        response.raise_for_status()
        return response.json() if response.text else {"deleted": len(record_ids)}


def redact_request_summary(
    method: str,
    url: str,
    headers: dict[str, str],
    body: Optional[dict] = None
) -> dict:
    """Create a redacted summary of an HTTP request for display.

    Args:
        method: HTTP method
        url: Request URL
        headers: Request headers
        body: Optional request body

    Returns:
        Redacted summary dict
    """
    redacted_headers = {}
    for key, value in headers.items():
        if key.lower() == "authorization":
            # Show token type but redact the actual token
            parts = value.split(" ", 1)
            if len(parts) == 2:
                token_type, token = parts
                redacted_headers[key] = f"{token_type} {token[:10]}...REDACTED"
            else:
                redacted_headers[key] = "REDACTED"
        elif "key" in key.lower() or "secret" in key.lower() or "token" in key.lower():
            redacted_headers[key] = "REDACTED"
        else:
            redacted_headers[key] = value

    return {
        "method": method,
        "url": url,
        "headers": redacted_headers,
        "body": body,
    }
