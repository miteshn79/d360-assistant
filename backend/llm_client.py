"""Provider-agnostic LLM client for generating data generation plans."""

import json
from abc import ABC, abstractmethod
from typing import Any, Optional

import httpx

from models import (
    FieldGenerationPlan,
    GenerationPlan,
    GeneratorType,
    LLMProvider,
    SchemaField,
)


class LLMClientError(Exception):
    """Exception raised when LLM API call fails."""
    pass


class BaseLLMClient(ABC):
    """Abstract base class for LLM clients."""

    @abstractmethod
    async def generate_plan(
        self,
        schema_fields: list[SchemaField],
        use_case: str
    ) -> GenerationPlan:
        """Generate a data generation plan based on schema and use case.

        Args:
            schema_fields: List of schema fields
            use_case: Description of the use case

        Returns:
            GenerationPlan with field generation instructions
        """
        pass


def _build_system_prompt() -> str:
    """Build the system prompt for LLM."""
    return """You generate JSON data plans. Respond with ONLY a JSON object, no other text.

Generator types: uuid4, timestamp_iso8601, date_iso8601, enum_choice, int_range, numeric_range, email, phone_e164, string, fixed_value, boolean, first_name, last_name, full_name, address, company, url, currency, country, city

JSON format:
{"fields":[{"field_name":"name","generator_type":"type","suggested_value":null,"constraints":{},"rationale":"why"}],"use_case":"desc"}"""


def _build_user_prompt(schema_fields: list[SchemaField], use_case: str) -> str:
    """Build the user prompt with schema and use case."""
    # Build compact schema representation
    schema_info = []
    for field in schema_fields:
        field_info = {"name": field.field_name, "type": field.field_type.value}
        if field.enum_values:
            field_info["enum"] = field.enum_values[:5]  # Limit enum values
        schema_info.append(field_info)

    # Limit to first 30 fields to keep prompt short
    if len(schema_info) > 30:
        schema_info = schema_info[:30]

    return f"""Schema: {json.dumps(schema_info)}
Use case: {use_case}
Return JSON only."""


def _parse_llm_response(response_text: str, use_case: str) -> GenerationPlan:
    """Parse LLM response into GenerationPlan.

    Args:
        response_text: Raw response text from LLM
        use_case: Original use case description

    Returns:
        Parsed GenerationPlan

    Raises:
        LLMClientError: If response cannot be parsed
    """
    # Try to extract JSON from response
    text = response_text.strip()

    # Remove markdown code blocks if present
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

    # Try to find JSON object in text
    start_idx = text.find("{")
    end_idx = text.rfind("}") + 1
    if start_idx >= 0 and end_idx > start_idx:
        text = text[start_idx:end_idx]

    # Try to parse the JSON
    data = None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        # Try to fix common JSON issues
        # 1. Try removing trailing commas before } or ]
        import re
        fixed_text = re.sub(r',(\s*[}\]])', r'\1', text)
        try:
            data = json.loads(fixed_text)
        except json.JSONDecodeError:
            pass

        # 2. Try to extract just the fields array if present
        if data is None:
            fields_match = re.search(r'"fields"\s*:\s*\[', text)
            if fields_match:
                # Find the matching closing bracket
                bracket_start = fields_match.end() - 1
                bracket_count = 0
                bracket_end = bracket_start
                for i, char in enumerate(text[bracket_start:]):
                    if char == '[':
                        bracket_count += 1
                    elif char == ']':
                        bracket_count -= 1
                        if bracket_count == 0:
                            bracket_end = bracket_start + i + 1
                            break
                if bracket_end > bracket_start:
                    fields_json = text[bracket_start:bracket_end]
                    try:
                        fields_array = json.loads(fields_json)
                        data = {"fields": fields_array, "use_case": use_case}
                    except json.JSONDecodeError:
                        pass

    if data is None:
        raise LLMClientError(f"Failed to parse LLM response as JSON. Response length: {len(response_text)} chars")

    # Validate and extract fields
    if "fields" not in data:
        raise LLMClientError("LLM response missing 'fields' key")

    field_plans = []
    for field_data in data["fields"]:
        try:
            # Validate generator type
            gen_type_str = field_data.get("generator_type", "string")
            try:
                gen_type = GeneratorType(gen_type_str)
            except ValueError:
                gen_type = GeneratorType.STRING  # Default fallback

            field_plan = FieldGenerationPlan(
                field_name=field_data["field_name"],
                generator_type=gen_type,
                suggested_value=field_data.get("suggested_value"),
                constraints=field_data.get("constraints", {}),
                rationale=field_data.get("rationale"),
            )
            field_plans.append(field_plan)
        except (KeyError, ValueError) as e:
            raise LLMClientError(f"Invalid field plan in response: {e}")

    return GenerationPlan(
        fields=field_plans,
        use_case=use_case,
    )


class PerplexityClient(BaseLLMClient):
    """LLM client for Perplexity API."""

    def __init__(self, api_key: str, model: str = "sonar"):
        """Initialize Perplexity client.

        Args:
            api_key: Perplexity API key
            model: Model to use
        """
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.perplexity.ai"
        self._http_client = httpx.AsyncClient(timeout=60.0)

    async def close(self):
        """Close the HTTP client."""
        await self._http_client.aclose()

    async def chat(
        self,
        messages: list[dict],
        context: dict = None,
    ) -> str:
        """Send a chat message and get a response.

        Args:
            messages: List of message dicts with 'role' and 'content'
            context: Optional context dict (unused for now)

        Returns:
            The assistant's response text
        """
        try:
            response = await self._http_client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": 2048,
                    "temperature": 0.3,
                },
            )
            response.raise_for_status()

            data = response.json()
            return data["choices"][0]["message"]["content"]

        except httpx.HTTPStatusError as e:
            raise LLMClientError(f"Perplexity API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise LLMClientError(f"Perplexity API call failed: {str(e)}")

    async def generate_plan(
        self,
        schema_fields: list[SchemaField],
        use_case: str,
        retry: bool = True
    ) -> GenerationPlan:
        """Generate a data generation plan using Perplexity API."""
        messages = [
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": _build_user_prompt(schema_fields, use_case)},
        ]

        try:
            response = await self._http_client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": 2048,  # Reduced to avoid overly long responses
                    "temperature": 0.1,  # Lower temperature for more consistent JSON
                },
            )
            response.raise_for_status()

            data = response.json()
            response_text = data["choices"][0]["message"]["content"]

            try:
                return _parse_llm_response(response_text, use_case)
            except LLMClientError:
                if retry:
                    # Retry once with a more explicit prompt
                    messages.append({"role": "assistant", "content": response_text})
                    messages.append({
                        "role": "user",
                        "content": "That response was not valid JSON. Please respond with ONLY a valid JSON object, no other text or formatting."
                    })
                    return await self.generate_plan(schema_fields, use_case, retry=False)
                raise

        except httpx.HTTPStatusError as e:
            raise LLMClientError(f"Perplexity API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise LLMClientError(f"Perplexity API call failed: {str(e)}")


class OpenAIClient(BaseLLMClient):
    """LLM client for OpenAI API."""

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        """Initialize OpenAI client.

        Args:
            api_key: OpenAI API key
            model: Model to use
        """
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.openai.com/v1"
        self._http_client = httpx.AsyncClient(timeout=60.0)

    async def close(self):
        """Close the HTTP client."""
        await self._http_client.aclose()

    async def generate_plan(
        self,
        schema_fields: list[SchemaField],
        use_case: str,
        retry: bool = True
    ) -> GenerationPlan:
        """Generate a data generation plan using OpenAI API."""
        messages = [
            {"role": "system", "content": _build_system_prompt()},
            {"role": "user", "content": _build_user_prompt(schema_fields, use_case)},
        ]

        try:
            response = await self._http_client.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "messages": messages,
                    "max_tokens": 4096,
                    "temperature": 0.2,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()

            data = response.json()
            response_text = data["choices"][0]["message"]["content"]

            try:
                return _parse_llm_response(response_text, use_case)
            except LLMClientError:
                if retry:
                    return await self.generate_plan(schema_fields, use_case, retry=False)
                raise

        except httpx.HTTPStatusError as e:
            raise LLMClientError(f"OpenAI API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise LLMClientError(f"OpenAI API call failed: {str(e)}")


class AnthropicClient(BaseLLMClient):
    """LLM client for Anthropic API."""

    def __init__(self, api_key: str, model: str = "claude-3-haiku-20240307"):
        """Initialize Anthropic client.

        Args:
            api_key: Anthropic API key
            model: Model to use
        """
        self.api_key = api_key
        self.model = model
        self.base_url = "https://api.anthropic.com/v1"
        self._http_client = httpx.AsyncClient(timeout=60.0)

    async def close(self):
        """Close the HTTP client."""
        await self._http_client.aclose()

    async def generate_plan(
        self,
        schema_fields: list[SchemaField],
        use_case: str,
        retry: bool = True
    ) -> GenerationPlan:
        """Generate a data generation plan using Anthropic API."""
        try:
            response = await self._http_client.post(
                f"{self.base_url}/messages",
                headers={
                    "x-api-key": self.api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.model,
                    "max_tokens": 4096,
                    "system": _build_system_prompt(),
                    "messages": [
                        {"role": "user", "content": _build_user_prompt(schema_fields, use_case)},
                    ],
                },
            )
            response.raise_for_status()

            data = response.json()
            response_text = data["content"][0]["text"]

            try:
                return _parse_llm_response(response_text, use_case)
            except LLMClientError:
                if retry:
                    return await self.generate_plan(schema_fields, use_case, retry=False)
                raise

        except httpx.HTTPStatusError as e:
            raise LLMClientError(f"Anthropic API error: {e.response.status_code} - {e.response.text}")
        except Exception as e:
            raise LLMClientError(f"Anthropic API call failed: {str(e)}")


def create_llm_client(
    provider: LLMProvider,
    api_key: str,
    model: Optional[str] = None
) -> BaseLLMClient:
    """Factory function to create LLM client based on provider.

    Args:
        provider: LLM provider to use
        api_key: API key for the provider
        model: Optional model override

    Returns:
        Configured LLM client

    Raises:
        ValueError: If provider is not supported
    """
    if provider == LLMProvider.PERPLEXITY:
        return PerplexityClient(api_key, model or "sonar")
    elif provider == LLMProvider.OPENAI:
        return OpenAIClient(api_key, model or "gpt-4o-mini")
    elif provider == LLMProvider.ANTHROPIC:
        return AnthropicClient(api_key, model or "claude-3-haiku-20240307")
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def create_fallback_plan(schema_fields: list[SchemaField], use_case: str) -> GenerationPlan:
    """Create a basic generation plan without LLM (fallback).

    Args:
        schema_fields: List of schema fields
        use_case: Use case description

    Returns:
        Basic GenerationPlan based on field types
    """
    field_plans = []

    for field in schema_fields:
        # Determine generator type based on field type and name
        field_name_lower = field.field_name.lower()

        if field.enum_values:
            gen_type = GeneratorType.ENUM_CHOICE
            constraints = {"choices": field.enum_values}
        elif "email" in field_name_lower:
            gen_type = GeneratorType.EMAIL
            constraints = {}
        elif "phone" in field_name_lower:
            gen_type = GeneratorType.PHONE_E164
            constraints = {}
        elif "id" in field_name_lower and field.field_type.value == "string":
            gen_type = GeneratorType.UUID4
            constraints = {}
        elif "timestamp" in field_name_lower or "datetime" in field_name_lower:
            gen_type = GeneratorType.TIMESTAMP_ISO8601
            constraints = {}
        elif "date" in field_name_lower or field.field_type.value == "date":
            gen_type = GeneratorType.DATE_ISO8601
            constraints = {}
        elif "name" in field_name_lower:
            if "first" in field_name_lower:
                gen_type = GeneratorType.FIRST_NAME
            elif "last" in field_name_lower:
                gen_type = GeneratorType.LAST_NAME
            else:
                gen_type = GeneratorType.FULL_NAME
            constraints = {}
        elif "country" in field_name_lower:
            gen_type = GeneratorType.COUNTRY
            constraints = {}
        elif "city" in field_name_lower:
            gen_type = GeneratorType.CITY
            constraints = {}
        elif "address" in field_name_lower:
            gen_type = GeneratorType.ADDRESS
            constraints = {}
        elif "company" in field_name_lower or "org" in field_name_lower:
            gen_type = GeneratorType.COMPANY
            constraints = {}
        elif "url" in field_name_lower or "link" in field_name_lower:
            gen_type = GeneratorType.URL
            constraints = {}
        elif "lat" in field_name_lower or "long" in field_name_lower or "coord" in field_name_lower:
            gen_type = GeneratorType.LAT_LONG
            constraints = {}
        elif "price" in field_name_lower or "amount" in field_name_lower or "cost" in field_name_lower:
            gen_type = GeneratorType.CURRENCY
            constraints = {"min": 0, "max": 10000}
        elif field.field_type.value == "integer":
            gen_type = GeneratorType.INT_RANGE
            constraints = {
                "min": int(field.min_value) if field.min_value is not None else 0,
                "max": int(field.max_value) if field.max_value is not None else 1000,
            }
        elif field.field_type.value == "number":
            gen_type = GeneratorType.NUMERIC_RANGE
            constraints = {
                "min": field.min_value if field.min_value is not None else 0.0,
                "max": field.max_value if field.max_value is not None else 1000.0,
            }
        elif field.field_type.value == "boolean":
            gen_type = GeneratorType.BOOLEAN
            constraints = {}
        else:
            gen_type = GeneratorType.STRING
            constraints = {
                "min_length": field.min_length or 5,
                "max_length": field.max_length or 50,
            }

        field_plans.append(FieldGenerationPlan(
            field_name=field.field_name,
            generator_type=gen_type,
            constraints=constraints,
            rationale="Auto-generated based on field type and name",
        ))

    return GenerationPlan(
        fields=field_plans,
        use_case=use_case,
    )
