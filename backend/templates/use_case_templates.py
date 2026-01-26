"""Pre-built templates for common Data Cloud streaming use cases."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class FieldTemplate:
    """Template for a single field in a schema."""
    name: str
    type: str  # string, integer, number, boolean, datetime, date
    required: bool = False
    is_primary_key: bool = False
    is_profile_id: bool = False
    is_datetime: bool = False
    description: str = ""
    example: Optional[str] = None


@dataclass
class UseCaseTemplate:
    """Complete template for a streaming use case."""
    id: str
    name: str
    category: str  # "Financial", "Marketing", "Travel", "Retail", etc.
    description: str
    business_value: str
    fields: list[FieldTemplate]
    data_model_object: str  # Suggested DMO to map to
    sample_event: dict  # Example payload
    setup_notes: str  # Additional setup guidance


# ============================================================================
# TEMPLATE DEFINITIONS
# ============================================================================

CREDIT_CARD_TRANSACTION = UseCaseTemplate(
    id="credit_card_transaction",
    name="Credit Card Transaction",
    category="Financial Services",
    description="Real-time credit card transaction events for fraud detection, spend analysis, and personalization.",
    business_value="Enable real-time fraud alerts, spending insights, merchant recommendations, and reward optimization.",
    fields=[
        FieldTemplate("transactionId", "string", required=True, is_primary_key=True,
                      description="Unique transaction identifier", example="TXN-2024-001234"),
        FieldTemplate("customerId", "string", required=True, is_profile_id=True,
                      description="Customer/cardholder identifier", example="CUST-789456"),
        FieldTemplate("transactionDateTime", "datetime", required=True, is_datetime=True,
                      description="When the transaction occurred", example="2024-01-15T14:32:00Z"),
        FieldTemplate("amount", "number", required=True,
                      description="Transaction amount", example="125.50"),
        FieldTemplate("currency", "string", required=True,
                      description="ISO 4217 currency code", example="USD"),
        FieldTemplate("merchantName", "string", required=True,
                      description="Name of the merchant", example="Amazon.com"),
        FieldTemplate("merchantCategory", "string", required=False,
                      description="Merchant Category Code (MCC) description", example="Online Shopping"),
        FieldTemplate("merchantCategoryCode", "string", required=False,
                      description="4-digit MCC code", example="5411"),
        FieldTemplate("cardLastFour", "string", required=False,
                      description="Last 4 digits of card", example="4242"),
        FieldTemplate("transactionType", "string", required=False,
                      description="Purchase, Refund, Authorization, etc.", example="Purchase"),
        FieldTemplate("channel", "string", required=False,
                      description="POS, Online, Mobile, ATM", example="Online"),
        FieldTemplate("country", "string", required=False,
                      description="Transaction country", example="US"),
        FieldTemplate("city", "string", required=False,
                      description="Transaction city", example="Seattle"),
        FieldTemplate("isDeclined", "boolean", required=False,
                      description="Whether transaction was declined", example="false"),
        FieldTemplate("declineReason", "string", required=False,
                      description="Reason for decline if applicable", example=""),
    ],
    data_model_object="EngagementEvent",
    sample_event={
        "transactionId": "TXN-2024-001234",
        "customerId": "CUST-789456",
        "transactionDateTime": "2024-01-15T14:32:00Z",
        "amount": 125.50,
        "currency": "USD",
        "merchantName": "Amazon.com",
        "merchantCategory": "Online Shopping",
        "merchantCategoryCode": "5411",
        "cardLastFour": "4242",
        "transactionType": "Purchase",
        "channel": "Online",
        "country": "US",
        "city": "Seattle",
        "isDeclined": False
    },
    setup_notes="""
**Recommended Data Model Mapping:**
- Map to `EngagementEvent` or create a custom `Transaction` object
- Use `customerId` as the Party Identification field
- Consider creating calculated insights for: Monthly spend, Favorite merchants, Unusual activity

**Real-Time Data Graph:**
- Include in a graph with Customer Profile + Recent Transactions
- Useful for: Fraud detection, Next-best-offer, Spending insights
"""
)


CONSENT_SIGNAL = UseCaseTemplate(
    id="consent_signal",
    name="Consent & Preference Signal",
    category="Marketing & Privacy",
    description="Real-time consent and preference updates for GDPR/CCPA compliance and preference-based personalization.",
    business_value="Ensure marketing compliance, respect customer preferences in real-time, and enable preference-based personalization.",
    fields=[
        FieldTemplate("consentId", "string", required=True, is_primary_key=True,
                      description="Unique consent record identifier", example="CONS-2024-001234"),
        FieldTemplate("customerId", "string", required=True, is_profile_id=True,
                      description="Customer identifier", example="CUST-789456"),
        FieldTemplate("consentDateTime", "datetime", required=True, is_datetime=True,
                      description="When consent was captured", example="2024-01-15T10:00:00Z"),
        FieldTemplate("consentType", "string", required=True,
                      description="Type of consent: email_marketing, sms_marketing, data_sharing, etc.",
                      example="email_marketing"),
        FieldTemplate("consentStatus", "string", required=True,
                      description="opt_in, opt_out, pending", example="opt_in"),
        FieldTemplate("channel", "string", required=False,
                      description="Where consent was captured: web, mobile, call_center, store",
                      example="web"),
        FieldTemplate("source", "string", required=False,
                      description="Specific source: preference_center, checkout, signup",
                      example="preference_center"),
        FieldTemplate("legalBasis", "string", required=False,
                      description="GDPR legal basis: consent, legitimate_interest, contract",
                      example="consent"),
        FieldTemplate("expirationDate", "date", required=False,
                      description="When consent expires (if applicable)", example="2025-01-15"),
        FieldTemplate("version", "string", required=False,
                      description="Privacy policy version consented to", example="v2.3"),
        FieldTemplate("ipAddress", "string", required=False,
                      description="IP address for audit (hashed recommended)", example="192.168.x.x"),
        FieldTemplate("userAgent", "string", required=False,
                      description="Browser/device info for audit", example="Mozilla/5.0..."),
    ],
    data_model_object="ContactPointConsent",
    sample_event={
        "consentId": "CONS-2024-001234",
        "customerId": "CUST-789456",
        "consentDateTime": "2024-01-15T10:00:00Z",
        "consentType": "email_marketing",
        "consentStatus": "opt_in",
        "channel": "web",
        "source": "preference_center",
        "legalBasis": "consent",
        "version": "v2.3"
    },
    setup_notes="""
**Recommended Data Model Mapping:**
- Map to `ContactPointConsent` standard object
- Use `customerId` as the Party Identification field
- Track multiple consent types per customer

**Compliance Considerations:**
- Ensure timestamps are captured in UTC
- Store consent version for audit trail
- Consider data retention policies

**Real-Time Use Cases:**
- Suppress marketing in real-time when opt-out received
- Personalize based on stated preferences
- Power preference centers with current state
"""
)


FLIGHT_STATUS_CHANGE = UseCaseTemplate(
    id="flight_status_change",
    name="Flight Status Change",
    category="Travel & Hospitality",
    description="Real-time flight status updates for proactive customer communication and rebooking assistance.",
    business_value="Enable proactive disruption management, automated rebooking offers, and personalized travel assistance.",
    fields=[
        FieldTemplate("eventId", "string", required=True, is_primary_key=True,
                      description="Unique event identifier", example="EVT-2024-FL001234"),
        FieldTemplate("passengerId", "string", required=True, is_profile_id=True,
                      description="Passenger/traveler identifier", example="PAX-789456"),
        FieldTemplate("eventDateTime", "datetime", required=True, is_datetime=True,
                      description="When the status change occurred", example="2024-01-15T08:30:00Z"),
        FieldTemplate("flightNumber", "string", required=True,
                      description="Flight number", example="UA1234"),
        FieldTemplate("flightDate", "date", required=True,
                      description="Scheduled flight date", example="2024-01-15"),
        FieldTemplate("previousStatus", "string", required=False,
                      description="Previous flight status", example="On Time"),
        FieldTemplate("newStatus", "string", required=True,
                      description="New flight status: On Time, Delayed, Cancelled, Boarding, Departed, Arrived",
                      example="Delayed"),
        FieldTemplate("delayMinutes", "integer", required=False,
                      description="Delay duration in minutes", example="45"),
        FieldTemplate("delayReason", "string", required=False,
                      description="Reason for delay/cancellation", example="Weather"),
        FieldTemplate("originAirport", "string", required=True,
                      description="Origin airport code", example="SFO"),
        FieldTemplate("destinationAirport", "string", required=True,
                      description="Destination airport code", example="JFK"),
        FieldTemplate("scheduledDeparture", "datetime", required=False,
                      description="Originally scheduled departure", example="2024-01-15T09:00:00Z"),
        FieldTemplate("estimatedDeparture", "datetime", required=False,
                      description="Updated estimated departure", example="2024-01-15T09:45:00Z"),
        FieldTemplate("gateNumber", "string", required=False,
                      description="Departure gate", example="B42"),
        FieldTemplate("bookingReference", "string", required=False,
                      description="PNR/Confirmation number", example="ABC123"),
        FieldTemplate("cabinClass", "string", required=False,
                      description="Cabin class: Economy, Business, First", example="Business"),
        FieldTemplate("loyaltyTier", "string", required=False,
                      description="Frequent flyer tier", example="Gold"),
    ],
    data_model_object="EngagementEvent",
    sample_event={
        "eventId": "EVT-2024-FL001234",
        "passengerId": "PAX-789456",
        "eventDateTime": "2024-01-15T08:30:00Z",
        "flightNumber": "UA1234",
        "flightDate": "2024-01-15",
        "previousStatus": "On Time",
        "newStatus": "Delayed",
        "delayMinutes": 45,
        "delayReason": "Weather",
        "originAirport": "SFO",
        "destinationAirport": "JFK",
        "scheduledDeparture": "2024-01-15T09:00:00Z",
        "estimatedDeparture": "2024-01-15T09:45:00Z",
        "gateNumber": "B42",
        "cabinClass": "Business",
        "loyaltyTier": "Gold"
    },
    setup_notes="""
**Recommended Data Model Mapping:**
- Map to `EngagementEvent` or custom `FlightEvent` object
- Use `passengerId` as the Party Identification field
- Consider separate streams for bookings vs. status updates

**Real-Time Use Cases:**
- Proactive delay/cancellation notifications
- Automated rebooking recommendations based on preferences
- Lounge access offers for delayed premium passengers
- Connection risk alerts

**Data Graph Recommendations:**
- Include: Passenger Profile + Active Itinerary + Recent Flight Events
- Enable: Real-time decision making for service recovery
"""
)


WEB_BROWSING_EVENT = UseCaseTemplate(
    id="web_browsing_event",
    name="Web Browsing Event",
    category="Digital & E-commerce",
    description="Real-time web browsing and product interaction events for personalization and journey analytics.",
    business_value="Enable real-time personalization, cart abandonment recovery, and behavioral segmentation.",
    fields=[
        FieldTemplate("eventId", "string", required=True, is_primary_key=True,
                      description="Unique event identifier", example="WEB-2024-001234"),
        FieldTemplate("customerId", "string", required=True, is_profile_id=True,
                      description="Customer identifier (or cookie ID if anonymous)", example="CUST-789456"),
        FieldTemplate("eventDateTime", "datetime", required=True, is_datetime=True,
                      description="When the event occurred", example="2024-01-15T14:32:00Z"),
        FieldTemplate("eventType", "string", required=True,
                      description="page_view, product_view, add_to_cart, search, etc.", example="product_view"),
        FieldTemplate("pageUrl", "string", required=False,
                      description="Full page URL", example="https://example.com/products/shoe-123"),
        FieldTemplate("pageTitle", "string", required=False,
                      description="Page title", example="Running Shoes - Nike Air Max"),
        FieldTemplate("productId", "string", required=False,
                      description="Product identifier if applicable", example="PROD-123"),
        FieldTemplate("productName", "string", required=False,
                      description="Product name", example="Nike Air Max 90"),
        FieldTemplate("productCategory", "string", required=False,
                      description="Product category", example="Footwear > Running"),
        FieldTemplate("productPrice", "number", required=False,
                      description="Product price", example="129.99"),
        FieldTemplate("searchQuery", "string", required=False,
                      description="Search query if search event", example="running shoes"),
        FieldTemplate("referrer", "string", required=False,
                      description="Referring URL", example="https://google.com"),
        FieldTemplate("deviceType", "string", required=False,
                      description="desktop, mobile, tablet", example="mobile"),
        FieldTemplate("browser", "string", required=False,
                      description="Browser name", example="Chrome"),
        FieldTemplate("sessionId", "string", required=False,
                      description="Session identifier", example="SESS-abc123"),
    ],
    data_model_object="EngagementEvent",
    sample_event={
        "eventId": "WEB-2024-001234",
        "customerId": "CUST-789456",
        "eventDateTime": "2024-01-15T14:32:00Z",
        "eventType": "product_view",
        "pageUrl": "https://example.com/products/shoe-123",
        "pageTitle": "Running Shoes - Nike Air Max",
        "productId": "PROD-123",
        "productName": "Nike Air Max 90",
        "productCategory": "Footwear > Running",
        "productPrice": 129.99,
        "deviceType": "mobile",
        "browser": "Chrome",
        "sessionId": "SESS-abc123"
    },
    setup_notes="""
**Recommended Data Model Mapping:**
- Map to `EngagementEvent` standard object
- Use `customerId` for known users, `cookieId` for anonymous
- Implement identity stitching when user logs in

**Real-Time Use Cases:**
- Cart abandonment triggers
- Browse abandonment recovery
- Real-time product recommendations
- Session-based personalization

**Volume Considerations:**
- High-volume stream - consider batching
- Filter to high-value events (not every click)
"""
)


PURCHASE_TRANSACTION = UseCaseTemplate(
    id="purchase_transaction",
    name="Purchase/Order Event",
    category="Retail & E-commerce",
    description="Real-time purchase and order events for order confirmation, cross-sell, and customer lifetime value.",
    business_value="Enable real-time order confirmation journeys, post-purchase cross-sell, and CLV calculations.",
    fields=[
        FieldTemplate("orderId", "string", required=True, is_primary_key=True,
                      description="Unique order identifier", example="ORD-2024-001234"),
        FieldTemplate("customerId", "string", required=True, is_profile_id=True,
                      description="Customer identifier", example="CUST-789456"),
        FieldTemplate("orderDateTime", "datetime", required=True, is_datetime=True,
                      description="When the order was placed", example="2024-01-15T14:32:00Z"),
        FieldTemplate("orderTotal", "number", required=True,
                      description="Total order amount", example="249.99"),
        FieldTemplate("currency", "string", required=True,
                      description="Currency code", example="USD"),
        FieldTemplate("orderStatus", "string", required=True,
                      description="pending, confirmed, shipped, delivered, cancelled", example="confirmed"),
        FieldTemplate("itemCount", "integer", required=False,
                      description="Number of items", example="3"),
        FieldTemplate("channel", "string", required=False,
                      description="web, mobile_app, store, phone", example="web"),
        FieldTemplate("paymentMethod", "string", required=False,
                      description="credit_card, paypal, apple_pay, etc.", example="credit_card"),
        FieldTemplate("shippingMethod", "string", required=False,
                      description="standard, express, same_day", example="express"),
        FieldTemplate("discountCode", "string", required=False,
                      description="Promo code used", example="SAVE20"),
        FieldTemplate("discountAmount", "number", required=False,
                      description="Discount amount applied", example="20.00"),
        FieldTemplate("shippingAddress_city", "string", required=False,
                      description="Shipping city", example="San Francisco"),
        FieldTemplate("shippingAddress_state", "string", required=False,
                      description="Shipping state", example="CA"),
        FieldTemplate("shippingAddress_country", "string", required=False,
                      description="Shipping country", example="US"),
        FieldTemplate("isFirstPurchase", "boolean", required=False,
                      description="Whether this is customer's first order", example="false"),
    ],
    data_model_object="SalesOrder",
    sample_event={
        "orderId": "ORD-2024-001234",
        "customerId": "CUST-789456",
        "orderDateTime": "2024-01-15T14:32:00Z",
        "orderTotal": 249.99,
        "currency": "USD",
        "orderStatus": "confirmed",
        "itemCount": 3,
        "channel": "web",
        "paymentMethod": "credit_card",
        "shippingMethod": "express",
        "discountCode": "SAVE20",
        "discountAmount": 20.00,
        "shippingAddress_city": "San Francisco",
        "shippingAddress_state": "CA",
        "shippingAddress_country": "US",
        "isFirstPurchase": False
    },
    setup_notes="""
**Recommended Data Model Mapping:**
- Map to `SalesOrder` standard object
- Consider separate `SalesOrderProduct` for line items
- Use `customerId` as the Party Identification field

**Real-Time Use Cases:**
- Order confirmation journeys
- Post-purchase cross-sell/upsell
- First purchase welcome series
- VIP threshold triggers

**Integration Notes:**
- Consider separate streams for order creation vs. status updates
- Line item details may need a separate related stream
"""
)


# ============================================================================
# TEMPLATE REGISTRY
# ============================================================================

ALL_TEMPLATES: dict[str, UseCaseTemplate] = {
    "credit_card_transaction": CREDIT_CARD_TRANSACTION,
    "consent_signal": CONSENT_SIGNAL,
    "flight_status_change": FLIGHT_STATUS_CHANGE,
    "web_browsing_event": WEB_BROWSING_EVENT,
    "purchase_transaction": PURCHASE_TRANSACTION,
}

TEMPLATE_CATEGORIES = {
    "Financial Services": ["credit_card_transaction"],
    "Marketing & Privacy": ["consent_signal"],
    "Travel & Hospitality": ["flight_status_change"],
    "Digital & E-commerce": ["web_browsing_event", "purchase_transaction"],
}


def get_template(template_id: str) -> Optional[UseCaseTemplate]:
    """Get a template by ID."""
    return ALL_TEMPLATES.get(template_id)


def get_templates_by_category(category: str) -> list[UseCaseTemplate]:
    """Get all templates in a category."""
    template_ids = TEMPLATE_CATEGORIES.get(category, [])
    return [ALL_TEMPLATES[tid] for tid in template_ids if tid in ALL_TEMPLATES]


def get_all_categories() -> list[str]:
    """Get all available categories."""
    return list(TEMPLATE_CATEGORIES.keys())


def _to_pascal_case(name: str) -> str:
    """Convert template name to PascalCase for schema object name."""
    return "".join(word.capitalize() for word in name.replace("&", "And").replace("/", " ").split())


def template_to_yaml(template: UseCaseTemplate) -> str:
    """Convert a template to YAML schema format for Data Cloud ingestion.

    Produces the exact OpenAPI 3.0.3 format that Salesforce Data Cloud
    accepts for Streaming Ingestion API definitions.
    """
    schema_name = _to_pascal_case(template.name)
    yaml_lines = [
        "openapi: 3.0.3",
        "components:",
        "  schemas:",
        f"    {schema_name}:",
        "      type: object",
        "      properties:",
    ]

    for field in template.fields:
        yaml_lines.append(f"        {field.name}:")

        if field.type == "datetime":
            yaml_lines.append("          type: string")
            yaml_lines.append("          format: date-time")
        elif field.type == "date":
            yaml_lines.append("          type: string")
            yaml_lines.append("          format: date-time")
        elif field.type in ("number", "integer"):
            yaml_lines.append("          type: number")
        elif field.type == "boolean":
            yaml_lines.append("          type: boolean")
        else:
            yaml_lines.append("          type: string")

    return "\n".join(yaml_lines)


def template_to_sample_json(template: UseCaseTemplate) -> str:
    """Get sample JSON payload for a template."""
    import json
    return json.dumps(template.sample_event, indent=2)
