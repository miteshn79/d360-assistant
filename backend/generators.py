"""Deterministic data generators using Faker and custom generators."""

import random
import re
import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from faker import Faker

from models import (
    FieldGenerationPlan,
    GenerationPlan,
    GeneratorType,
    SchemaField,
)


class DataGenerator:
    """Deterministic data generator using Faker and custom generators."""

    def __init__(self, seed: Optional[int] = None):
        """Initialize the generator with an optional seed.

        Args:
            seed: Random seed for reproducible generation
        """
        self.seed = seed if seed is not None else random.randint(0, 2**32 - 1)
        # Use instance-specific Random for isolation
        self._rng = random.Random(self.seed)
        self.faker = Faker()
        self.faker.seed_instance(self.seed)

    def reset_seed(self, seed: Optional[int] = None):
        """Reset the random seed.

        Args:
            seed: New seed value (generates random if None)
        """
        self.seed = seed if seed is not None else random.randint(0, 2**32 - 1)
        self._rng = random.Random(self.seed)
        self.faker.seed_instance(self.seed)

    def generate_uuid4(self, constraints: dict[str, Any]) -> str:
        """Generate a UUID v4."""
        # Use instance random for reproducibility
        return str(uuid.UUID(int=self._rng.getrandbits(128), version=4))

    def generate_timestamp_iso8601(self, constraints: dict[str, Any]) -> str:
        """Generate an ISO8601 timestamp."""
        # Generate a timestamp within the last 30 days by default
        days_back = constraints.get("days_back", 30)
        base_time = datetime.utcnow()
        random_offset = timedelta(
            days=self._rng.randint(0, days_back),
            hours=self._rng.randint(0, 23),
            minutes=self._rng.randint(0, 59),
            seconds=self._rng.randint(0, 59)
        )
        timestamp = base_time - random_offset
        return timestamp.strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def generate_date_iso8601(self, constraints: dict[str, Any]) -> str:
        """Generate an ISO8601 date (YYYY-MM-DD)."""
        days_back = constraints.get("days_back", 365)
        days_forward = constraints.get("days_forward", 365)
        base_date = datetime.utcnow().date()
        offset = self._rng.randint(-days_back, days_forward)
        target_date = base_date + timedelta(days=offset)
        return target_date.strftime("%Y-%m-%d")

    def generate_enum_choice(self, constraints: dict[str, Any]) -> Any:
        """Choose from enum values."""
        choices = constraints.get("choices", [])
        if not choices:
            return None
        return self._rng.choice(choices)

    def generate_int_range(self, constraints: dict[str, Any]) -> int:
        """Generate an integer within range."""
        min_val = int(constraints.get("min", 0))
        max_val = int(constraints.get("max", 1000))
        return self._rng.randint(min_val, max_val)

    def generate_numeric_range(self, constraints: dict[str, Any]) -> float:
        """Generate a decimal number within range."""
        min_val = float(constraints.get("min", 0.0))
        max_val = float(constraints.get("max", 1000.0))
        precision = constraints.get("precision", 2)
        value = self._rng.uniform(min_val, max_val)
        return round(value, precision)

    def generate_email(self, constraints: dict[str, Any]) -> str:
        """Generate an email address."""
        domain = constraints.get("domain")
        if domain:
            name = self.faker.user_name()
            return f"{name}@{domain}"
        return self.faker.email()

    def generate_phone_e164(self, constraints: dict[str, Any]) -> str:
        """Generate a phone number in E.164 format."""
        country_code = constraints.get("country_code", "1")
        # Generate a 10-digit number for US/Canada style
        number = "".join([str(self._rng.randint(0, 9)) for _ in range(10)])
        return f"+{country_code}{number}"

    def generate_string(self, constraints: dict[str, Any]) -> str:
        """Generate a random string."""
        min_length = constraints.get("min_length", 5)
        max_length = constraints.get("max_length", 20)
        length = self._rng.randint(min_length, max_length)

        # Use Faker for more realistic strings
        text = self.faker.text(max_nb_chars=length * 2)
        # Clean up and trim to length
        text = re.sub(r'[^\w\s]', '', text).replace('\n', ' ')
        return text[:length]

    def generate_string_pattern(self, constraints: dict[str, Any]) -> str:
        """Generate a string matching a pattern."""
        pattern = constraints.get("pattern", r"[A-Z]{3}[0-9]{4}")

        # Simple pattern expansion for common patterns
        result = []
        i = 0
        while i < len(pattern):
            if pattern[i] == '[':
                # Find closing bracket
                end = pattern.find(']', i)
                if end == -1:
                    result.append(pattern[i])
                    i += 1
                    continue

                char_class = pattern[i+1:end]
                # Check for repetition
                repeat = 1
                if end + 1 < len(pattern) and pattern[end+1] == '{':
                    rep_end = pattern.find('}', end+1)
                    if rep_end != -1:
                        try:
                            repeat = int(pattern[end+2:rep_end])
                            end = rep_end
                        except ValueError:
                            pass

                # Expand character class
                chars = self._expand_char_class(char_class)
                for _ in range(repeat):
                    result.append(self._rng.choice(chars))
                i = end + 1
            elif pattern[i] == '\\':
                # Escape sequence
                if i + 1 < len(pattern):
                    if pattern[i+1] == 'd':
                        result.append(str(self._rng.randint(0, 9)))
                    elif pattern[i+1] == 'w':
                        result.append(self._rng.choice('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'))
                    else:
                        result.append(pattern[i+1])
                    i += 2
                else:
                    i += 1
            elif pattern[i] in '.+*?^$|(){}':
                # Skip regex metacharacters
                i += 1
            else:
                result.append(pattern[i])
                i += 1

        return ''.join(result)

    def _expand_char_class(self, char_class: str) -> str:
        """Expand a regex character class to a string of possible characters."""
        chars = []
        i = 0
        while i < len(char_class):
            if i + 2 < len(char_class) and char_class[i+1] == '-':
                # Range like A-Z
                start = ord(char_class[i])
                end = ord(char_class[i+2])
                chars.extend([chr(c) for c in range(start, end + 1)])
                i += 3
            else:
                chars.append(char_class[i])
                i += 1
        return ''.join(chars) if chars else 'X'

    def generate_country(self, constraints: dict[str, Any]) -> str:
        """Generate a country name or code."""
        code_type = constraints.get("type", "name")
        if code_type == "code":
            return self.faker.country_code()
        return self.faker.country()

    def generate_city(self, constraints: dict[str, Any]) -> str:
        """Generate a city name."""
        return self.faker.city()

    def generate_lat_long(self, constraints: dict[str, Any]) -> dict[str, float]:
        """Generate latitude/longitude coordinates."""
        lat = round(self._rng.uniform(-90, 90), 6)
        lon = round(self._rng.uniform(-180, 180), 6)

        output_format = constraints.get("format", "object")
        if output_format == "string":
            return f"{lat},{lon}"
        elif output_format == "lat":
            return lat
        elif output_format == "lon":
            return lon
        return {"latitude": lat, "longitude": lon}

    def generate_fixed_value(self, constraints: dict[str, Any]) -> Any:
        """Return a fixed value."""
        return constraints.get("value")

    def generate_boolean(self, constraints: dict[str, Any]) -> bool:
        """Generate a boolean value."""
        probability = constraints.get("probability_true", 0.5)
        return self._rng.random() < probability

    def generate_first_name(self, constraints: dict[str, Any]) -> str:
        """Generate a first name."""
        gender = constraints.get("gender")
        if gender == "male":
            return self.faker.first_name_male()
        elif gender == "female":
            return self.faker.first_name_female()
        return self.faker.first_name()

    def generate_last_name(self, constraints: dict[str, Any]) -> str:
        """Generate a last name."""
        return self.faker.last_name()

    def generate_full_name(self, constraints: dict[str, Any]) -> str:
        """Generate a full name."""
        return self.faker.name()

    def generate_address(self, constraints: dict[str, Any]) -> str:
        """Generate a street address."""
        return self.faker.street_address()

    def generate_company(self, constraints: dict[str, Any]) -> str:
        """Generate a company name."""
        return self.faker.company()

    def generate_url(self, constraints: dict[str, Any]) -> str:
        """Generate a URL."""
        domain = constraints.get("domain")
        if domain:
            path = self.faker.uri_path()
            return f"https://{domain}/{path}"
        return self.faker.url()

    def generate_currency(self, constraints: dict[str, Any]) -> float:
        """Generate a currency amount."""
        min_val = float(constraints.get("min", 0.01))
        max_val = float(constraints.get("max", 9999.99))
        return round(self._rng.uniform(min_val, max_val), 2)

    def generate_value(
        self,
        generator_type: GeneratorType,
        constraints: dict[str, Any]
    ) -> Any:
        """Generate a value based on generator type.

        Args:
            generator_type: Type of generator to use
            constraints: Constraints for generation

        Returns:
            Generated value
        """
        generators = {
            GeneratorType.UUID4: self.generate_uuid4,
            GeneratorType.TIMESTAMP_ISO8601: self.generate_timestamp_iso8601,
            GeneratorType.DATE_ISO8601: self.generate_date_iso8601,
            GeneratorType.ENUM_CHOICE: self.generate_enum_choice,
            GeneratorType.INT_RANGE: self.generate_int_range,
            GeneratorType.NUMERIC_RANGE: self.generate_numeric_range,
            GeneratorType.EMAIL: self.generate_email,
            GeneratorType.PHONE_E164: self.generate_phone_e164,
            GeneratorType.STRING: self.generate_string,
            GeneratorType.STRING_PATTERN: self.generate_string_pattern,
            GeneratorType.COUNTRY: self.generate_country,
            GeneratorType.CITY: self.generate_city,
            GeneratorType.LAT_LONG: self.generate_lat_long,
            GeneratorType.FIXED_VALUE: self.generate_fixed_value,
            GeneratorType.BOOLEAN: self.generate_boolean,
            GeneratorType.FIRST_NAME: self.generate_first_name,
            GeneratorType.LAST_NAME: self.generate_last_name,
            GeneratorType.FULL_NAME: self.generate_full_name,
            GeneratorType.ADDRESS: self.generate_address,
            GeneratorType.COMPANY: self.generate_company,
            GeneratorType.URL: self.generate_url,
            GeneratorType.CURRENCY: self.generate_currency,
        }

        generator_func = generators.get(generator_type)
        if generator_func:
            return generator_func(constraints)

        # Fallback to string
        return self.generate_string(constraints)

    def generate_payload(self, plan: GenerationPlan) -> dict[str, Any]:
        """Generate a complete payload from a generation plan.

        Args:
            plan: The generation plan with field specifications

        Returns:
            Generated payload dictionary
        """
        payload = {}

        for field_plan in plan.fields:
            # Use suggested value if provided and not None
            if field_plan.suggested_value is not None:
                value = field_plan.suggested_value
            else:
                value = self.generate_value(
                    field_plan.generator_type,
                    field_plan.constraints
                )

            # Handle nested field names (e.g., "address.city")
            self._set_nested_value(payload, field_plan.field_name, value)

        return payload

    def _set_nested_value(self, obj: dict, path: str, value: Any):
        """Set a value in a nested dictionary using dot notation.

        Args:
            obj: Target dictionary
            path: Dot-separated path (e.g., "address.city")
            value: Value to set
        """
        parts = path.split(".")
        current = obj

        for i, part in enumerate(parts[:-1]):
            if part not in current:
                current[part] = {}
            current = current[part]

        current[parts[-1]] = value


def generate_from_plan(
    plan: GenerationPlan,
    seed: Optional[int] = None
) -> dict[str, Any]:
    """Generate a payload from a generation plan.

    Args:
        plan: The generation plan
        seed: Optional seed for reproducibility

    Returns:
        Generated payload
    """
    generator = DataGenerator(seed or plan.seed)
    return generator.generate_payload(plan)


def generate_sample_values(
    schema_fields: list[SchemaField],
    count: int = 1,
    seed: Optional[int] = None
) -> list[dict[str, Any]]:
    """Generate sample values directly from schema fields (without LLM plan).

    Args:
        schema_fields: List of schema fields
        count: Number of samples to generate
        seed: Optional seed for reproducibility

    Returns:
        List of generated payloads
    """
    from llm_client import create_fallback_plan

    plan = create_fallback_plan(schema_fields, "Sample generation")
    plan.seed = seed

    samples = []
    generator = DataGenerator(seed)

    for i in range(count):
        if i > 0:
            generator.reset_seed()  # New seed for each sample
        samples.append(generator.generate_payload(plan))

    return samples


def update_plan_with_overrides(
    plan: GenerationPlan,
    overrides: dict[str, Any]
) -> GenerationPlan:
    """Update a generation plan with user overrides.

    Args:
        plan: Original generation plan
        overrides: Dictionary of field_name -> override value

    Returns:
        Updated GenerationPlan with overrides applied
    """
    updated_fields = []

    for field_plan in plan.fields:
        if field_plan.field_name in overrides:
            # Create a new field plan with the override as suggested value
            updated_plan = FieldGenerationPlan(
                field_name=field_plan.field_name,
                generator_type=GeneratorType.FIXED_VALUE,
                suggested_value=overrides[field_plan.field_name],
                constraints={"value": overrides[field_plan.field_name]},
                rationale="User override",
            )
            updated_fields.append(updated_plan)
        else:
            updated_fields.append(field_plan)

    return GenerationPlan(
        fields=updated_fields,
        use_case=plan.use_case,
        seed=plan.seed,
    )
