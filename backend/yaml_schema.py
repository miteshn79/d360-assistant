"""YAML schema parser and normalizer for Data Cloud ingestion definitions."""

from typing import Any, Optional

import yaml

from models import FieldType, SchemaField


class YAMLSchemaParseError(Exception):
    """Exception raised when YAML schema parsing fails."""
    pass


def parse_yaml_content(content: str) -> dict[str, Any]:
    """Parse YAML content string.

    Args:
        content: YAML content as string

    Returns:
        Parsed YAML as dictionary

    Raises:
        YAMLSchemaParseError: If YAML parsing fails
    """
    try:
        return yaml.safe_load(content)
    except yaml.YAMLError as e:
        raise YAMLSchemaParseError(f"Failed to parse YAML: {str(e)}")


def _map_type_to_field_type(type_str: str, format_str: Optional[str] = None) -> FieldType:
    """Map a type string to FieldType enum.

    Args:
        type_str: The type string from schema
        format_str: Optional format hint

    Returns:
        Corresponding FieldType
    """
    type_lower = type_str.lower()

    # Check for date/datetime based on format
    if format_str:
        format_lower = format_str.lower()
        if format_lower in ("date", "date-only"):
            return FieldType.DATE
        if format_lower in ("datetime", "date-time", "iso8601"):
            return FieldType.DATETIME

    # Map basic types
    type_mapping = {
        "string": FieldType.STRING,
        "str": FieldType.STRING,
        "text": FieldType.STRING,
        "integer": FieldType.INTEGER,
        "int": FieldType.INTEGER,
        "long": FieldType.INTEGER,
        "number": FieldType.NUMBER,
        "float": FieldType.NUMBER,
        "double": FieldType.NUMBER,
        "decimal": FieldType.NUMBER,
        "boolean": FieldType.BOOLEAN,
        "bool": FieldType.BOOLEAN,
        "date": FieldType.DATE,
        "datetime": FieldType.DATETIME,
        "timestamp": FieldType.DATETIME,
        "object": FieldType.OBJECT,
        "array": FieldType.ARRAY,
        "list": FieldType.ARRAY,
    }

    return type_mapping.get(type_lower, FieldType.STRING)


def _extract_constraints(field_def: dict[str, Any]) -> dict[str, Any]:
    """Extract constraints from a field definition.

    Args:
        field_def: The field definition dictionary

    Returns:
        Dictionary of constraints
    """
    constraints = {}

    # Numeric constraints
    if "minimum" in field_def:
        constraints["min_value"] = field_def["minimum"]
    if "maximum" in field_def:
        constraints["max_value"] = field_def["maximum"]
    if "min" in field_def:
        constraints["min_value"] = field_def["min"]
    if "max" in field_def:
        constraints["max_value"] = field_def["max"]
    if "exclusiveMinimum" in field_def:
        constraints["min_value"] = field_def["exclusiveMinimum"]
    if "exclusiveMaximum" in field_def:
        constraints["max_value"] = field_def["exclusiveMaximum"]

    # String constraints
    if "minLength" in field_def:
        constraints["min_length"] = field_def["minLength"]
    if "maxLength" in field_def:
        constraints["max_length"] = field_def["maxLength"]
    if "pattern" in field_def:
        constraints["pattern"] = field_def["pattern"]

    return constraints


def _is_likely_primary_key(field_name: str, field_def: dict[str, Any]) -> bool:
    """Detect if a field is likely a primary key based on naming patterns.

    Args:
        field_name: Name of the field
        field_def: Field definition dictionary

    Returns:
        True if the field appears to be a primary key
    """
    name_lower = field_name.lower()

    # Check for explicit primary key indicators in field definition
    if field_def.get("primaryKey") or field_def.get("primary_key"):
        return True

    # Check description for primary key mentions
    description = (field_def.get("description") or "").lower()
    if "primary key" in description or "unique identifier" in description:
        return True

    # Common primary key naming patterns (case-insensitive)
    # Match exact patterns or patterns at word boundaries
    primary_key_patterns = [
        "id",           # exact match for "id"
        "key",          # exact match for "key"
        "uuid",         # exact match for "uuid"
        "guid",         # exact match for "guid"
    ]

    # Check for exact match
    if name_lower in primary_key_patterns:
        return True

    # Check for suffix patterns like "eventId", "recordId", "customerId"
    suffix_patterns = ["id", "key", "uuid", "guid"]
    for suffix in suffix_patterns:
        # Check if field ends with the pattern (like "eventId", "userId")
        if name_lower.endswith(suffix) and len(name_lower) > len(suffix):
            # Make sure there's a word boundary (capital letter before or underscore)
            prefix = field_name[:-len(suffix)]
            if prefix.endswith("_") or (prefix and prefix[-1].isupper()):
                return True
            # Also check camelCase like "eventId"
            if len(prefix) > 0 and field_name[-len(suffix)].isupper():
                return True

    # Check for prefix patterns like "id_", "pk_"
    prefix_patterns = ["id_", "pk_", "uuid_", "primary_"]
    for prefix in prefix_patterns:
        if name_lower.startswith(prefix):
            return True

    return False


def _parse_field(
    field_name: str,
    field_def: dict[str, Any],
    required_fields: list[str]
) -> SchemaField:
    """Parse a single field definition into SchemaField.

    Args:
        field_name: Name of the field
        field_def: Field definition dictionary
        required_fields: List of required field names

    Returns:
        Parsed SchemaField
    """
    # Get type and format
    field_type_str = field_def.get("type", "string")
    format_str = field_def.get("format")

    # Handle array items
    items_def = field_def.get("items", {})

    # Get field type
    field_type = _map_type_to_field_type(field_type_str, format_str)

    # Extract constraints
    constraints = _extract_constraints(field_def)

    # Get enum values
    enum_values = field_def.get("enum")

    # Get description
    description = field_def.get("description") or field_def.get("title")

    # Handle nested schema for objects
    nested_schema = None
    if field_type == FieldType.OBJECT and "properties" in field_def:
        nested_required = field_def.get("required", [])
        nested_schema = []
        for nested_name, nested_def in field_def["properties"].items():
            if isinstance(nested_def, dict):
                nested_schema.append(_parse_field(nested_name, nested_def, nested_required))

    # Handle array items schema
    if field_type == FieldType.ARRAY and items_def:
        if isinstance(items_def, dict) and "properties" in items_def:
            items_required = items_def.get("required", [])
            nested_schema = []
            for item_name, item_def in items_def["properties"].items():
                if isinstance(item_def, dict):
                    nested_schema.append(_parse_field(item_name, item_def, items_required))

    return SchemaField(
        field_name=field_name,
        field_type=field_type,
        required=field_name in required_fields,
        is_primary_key=_is_likely_primary_key(field_name, field_def),
        enum_values=enum_values,
        format=format_str,
        min_value=constraints.get("min_value"),
        max_value=constraints.get("max_value"),
        min_length=constraints.get("min_length"),
        max_length=constraints.get("max_length"),
        pattern=constraints.get("pattern"),
        description=description,
        nested_schema=nested_schema,
    )


def normalize_schema(yaml_data: dict[str, Any]) -> list[SchemaField]:
    """Normalize a YAML schema definition to a list of SchemaField objects.

    Supports multiple schema formats:
    - OpenAPI/Swagger style (components/schemas or definitions)
    - RAML style (types)
    - Direct properties definition
    - Data Cloud ingestion API schema format

    Args:
        yaml_data: Parsed YAML data

    Returns:
        List of normalized SchemaField objects

    Raises:
        YAMLSchemaParseError: If schema cannot be normalized
    """
    fields = []
    properties = {}
    required_fields = []

    # Try to find the schema definition in various formats

    # 1. Direct properties at root
    if "properties" in yaml_data:
        properties = yaml_data["properties"]
        required_fields = yaml_data.get("required", [])

    # 2. OpenAPI components/schemas style
    elif "components" in yaml_data and "schemas" in yaml_data["components"]:
        schemas = yaml_data["components"]["schemas"]
        # Use the first schema or look for a specific one
        for schema_name, schema_def in schemas.items():
            if isinstance(schema_def, dict) and "properties" in schema_def:
                properties = schema_def["properties"]
                required_fields = schema_def.get("required", [])
                break

    # 3. OpenAPI definitions style (Swagger 2.0)
    elif "definitions" in yaml_data:
        definitions = yaml_data["definitions"]
        for def_name, def_value in definitions.items():
            if isinstance(def_value, dict) and "properties" in def_value:
                properties = def_value["properties"]
                required_fields = def_value.get("required", [])
                break

    # 4. RAML types style
    elif "types" in yaml_data:
        types = yaml_data["types"]
        for type_name, type_def in types.items():
            if isinstance(type_def, dict) and "properties" in type_def:
                properties = type_def["properties"]
                required_fields = type_def.get("required", [])
                break

    # 5. Data Cloud ingestion schema format
    elif "schema" in yaml_data:
        schema = yaml_data["schema"]
        if isinstance(schema, dict):
            if "fields" in schema:
                # Fields as a list
                for field in schema["fields"]:
                    if isinstance(field, dict):
                        field_name = field.get("name", field.get("fieldName", ""))
                        if field_name:
                            properties[field_name] = field
                            if field.get("required", False):
                                required_fields.append(field_name)
            elif "properties" in schema:
                properties = schema["properties"]
                required_fields = schema.get("required", [])

    # 6. Fields as a list at root level
    elif "fields" in yaml_data:
        for field in yaml_data["fields"]:
            if isinstance(field, dict):
                field_name = field.get("name", field.get("fieldName", ""))
                if field_name:
                    properties[field_name] = field
                    if field.get("required", False):
                        required_fields.append(field_name)

    # 7. OpenAPI paths with request body schema
    elif "paths" in yaml_data:
        for path, methods in yaml_data["paths"].items():
            if isinstance(methods, dict):
                for method, details in methods.items():
                    if method.lower() in ("post", "put", "patch") and isinstance(details, dict):
                        request_body = details.get("requestBody", {})
                        content = request_body.get("content", {})
                        json_content = content.get("application/json", {})
                        schema = json_content.get("schema", {})

                        if "properties" in schema:
                            properties = schema["properties"]
                            required_fields = schema.get("required", [])
                            break

                        # Handle $ref
                        if "$ref" in schema:
                            ref_path = schema["$ref"]
                            # Try to resolve the reference
                            ref_parts = ref_path.split("/")
                            ref_schema = yaml_data
                            for part in ref_parts:
                                if part == "#":
                                    continue
                                if isinstance(ref_schema, dict) and part in ref_schema:
                                    ref_schema = ref_schema[part]

                            if isinstance(ref_schema, dict) and "properties" in ref_schema:
                                properties = ref_schema["properties"]
                                required_fields = ref_schema.get("required", [])
                                break

    if not properties:
        raise YAMLSchemaParseError(
            "Could not find schema properties in YAML. "
            "Expected formats: OpenAPI, RAML, or direct 'properties'/'fields' definition."
        )

    # Parse each field
    for field_name, field_def in properties.items():
        if isinstance(field_def, dict):
            fields.append(_parse_field(field_name, field_def, required_fields))
        elif isinstance(field_def, str):
            # Simple type definition like "fieldName: string"
            fields.append(SchemaField(
                field_name=field_name,
                field_type=_map_type_to_field_type(field_def),
                required=field_name in required_fields,
            ))

    return fields


def schema_to_table_data(fields: list[SchemaField], prefix: str = "") -> list[dict[str, Any]]:
    """Convert schema fields to table data for display.

    Args:
        fields: List of SchemaField objects
        prefix: Prefix for nested field names

    Returns:
        List of dictionaries suitable for table display
    """
    table_data = []

    for field in fields:
        full_name = f"{prefix}{field.field_name}" if prefix else field.field_name

        constraints = []
        if field.min_value is not None:
            constraints.append(f"min: {field.min_value}")
        if field.max_value is not None:
            constraints.append(f"max: {field.max_value}")
        if field.min_length is not None:
            constraints.append(f"minLen: {field.min_length}")
        if field.max_length is not None:
            constraints.append(f"maxLen: {field.max_length}")
        if field.pattern:
            constraints.append(f"pattern: {field.pattern}")

        table_data.append({
            "Field Name": full_name,
            "Type": field.field_type.value,
            "PK": "🔑" if field.is_primary_key else "",
            "Required": "Yes" if field.required else "No",
            "Enum": ", ".join(field.enum_values) if field.enum_values else "",
            "Format": field.format or "",
            "Constraints": ", ".join(constraints) if constraints else "",
            "Description": field.description or "",
        })

        # Add nested fields
        if field.nested_schema:
            nested_prefix = f"{full_name}."
            table_data.extend(schema_to_table_data(field.nested_schema, nested_prefix))

    return table_data


def fields_to_json_schema(fields: list[SchemaField]) -> dict[str, Any]:
    """Convert SchemaField list to JSON Schema format.

    Args:
        fields: List of SchemaField objects

    Returns:
        JSON Schema dictionary
    """
    properties = {}
    required = []

    for field in fields:
        prop = {
            "type": field.field_type.value,
        }

        if field.enum_values:
            prop["enum"] = field.enum_values
        if field.format:
            prop["format"] = field.format
        if field.min_value is not None:
            prop["minimum"] = field.min_value
        if field.max_value is not None:
            prop["maximum"] = field.max_value
        if field.min_length is not None:
            prop["minLength"] = field.min_length
        if field.max_length is not None:
            prop["maxLength"] = field.max_length
        if field.pattern:
            prop["pattern"] = field.pattern
        if field.description:
            prop["description"] = field.description

        if field.nested_schema:
            if field.field_type == FieldType.OBJECT:
                nested_schema = fields_to_json_schema(field.nested_schema)
                prop["properties"] = nested_schema["properties"]
                if nested_schema.get("required"):
                    prop["required"] = nested_schema["required"]
            elif field.field_type == FieldType.ARRAY:
                nested_schema = fields_to_json_schema(field.nested_schema)
                prop["items"] = {
                    "type": "object",
                    "properties": nested_schema["properties"],
                }
                if nested_schema.get("required"):
                    prop["items"]["required"] = nested_schema["required"]

        properties[field.field_name] = prop

        if field.required:
            required.append(field.field_name)

    schema = {
        "type": "object",
        "properties": properties,
    }

    if required:
        schema["required"] = required

    return schema
