"""Generates the Postman collection and environment in this folder.

    python postman/generate_collection.py

Scripts in the collection only chain variables (token, ids, idempotency keys);
they deliberately contain no assertions.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
COLLECTION_FILE = HERE / "SchoolFees.postman_collection.json"
ENVIRONMENT_FILE = HERE / "SchoolFees.local.postman_environment.json"

JSON_HEADER = {"key": "Content-Type", "value": "application/json"}


def script(listen: str, lines: list[str]) -> dict:
    return {"listen": listen, "script": {"type": "text/javascript", "exec": lines}}


def request(
    name: str,
    method: str,
    path: str,
    *,
    description: str = "",
    body: dict | None = None,
    headers: list[dict] | None = None,
    query: list[tuple[str, str, bool]] | None = None,
    auth: bool = True,
    pre: list[str] | None = None,
    post: list[str] | None = None,
) -> dict:
    segments = [s for s in path.strip("/").split("/") if s]
    raw = "{{baseUrl}}/" + "/".join(segments)
    url: dict = {"raw": raw, "host": ["{{baseUrl}}"], "path": segments}
    if query:
        url["query"] = [{"key": k, "value": v, "disabled": not enabled} for k, v, enabled in query]
        enabled = [f"{k}={v}" for k, v, on in query if on]
        if enabled:
            url["raw"] += "?" + "&".join(enabled)
    req: dict = {"method": method, "header": list(headers or []), "url": url, "description": description}
    if body is not None:
        req["header"].append(JSON_HEADER)
        raw_body = json.dumps(body, indent=2).replace('"{{amountCents}}"', "{{amountCents}}")
        req["body"] = {"mode": "raw", "raw": raw_body, "options": {"raw": {"language": "json"}}}
    if not auth:
        req["auth"] = {"type": "noauth"}
    item: dict = {"name": name, "request": req}
    events = []
    if pre:
        events.append(script("prerequest", pre))
    if post:
        events.append(script("test", post))
    if events:
        item["event"] = events
    return item


def folder(name: str, items: list[dict], description: str = "") -> dict:
    return {"name": name, "description": description, "item": items}


SET_PAYMENT_ID = [
    "// Stores the payment id for the following requests (no assertions).",
    "if (pm.response.code === 200 || pm.response.code === 201) {",
    "  pm.environment.set('paymentId', pm.response.json().id);",
    "}",
]
NEW_KEY = [
    "// A fresh Idempotency-Key per new payment attempt.",
    "pm.environment.set('idempotencyKey', pm.variables.replaceIn('{{$guid}}'));",
]


def card(number: str) -> dict:
    return {
        "card": {
            "number": number,
            "expiry_month": 12,
            "expiry_year": 2030,
            "cvc": "123",
            "holder_name": "Thandi Mokoena",
        }
    }


def build_collection() -> dict:
    confirm_desc = (
        "Confirms the payment in `{{paymentId}}`. Run **Create payment (new key)** first; each confirm "
        "needs a PENDING payment. Outcome is decided by the card number."
    )
    items = [
        folder("Health", [request("Health check", "GET", "/health", auth=False,
                                  description="Liveness/readiness. Never delayed by the simulation.")]),
        folder("Auth", [
            request(
                "Login", "POST", "/auth/login", auth=False,
                body={"email": "{{email}}", "password": "{{password}}"},
                description="Logs in and stores `accessToken` in the environment.",
                post=[
                    "if (pm.response.code === 200) {",
                    "  pm.environment.set('accessToken', pm.response.json().access_token);",
                    "}",
                ],
            ),
            request("Login - invalid password (401)", "POST", "/auth/login", auth=False,
                    body={"email": "{{email}}", "password": "wrong-password"}),
            request("Login - invalid body (422)", "POST", "/auth/login", auth=False,
                    body={"email": "not-an-email", "password": ""}),
            request("Current parent", "GET", "/auth/me"),
            request("Logout", "POST", "/auth/logout",
                    description="Revokes the token. Subsequent calls with it return 401 INVALID_TOKEN."),
        ]),
        folder("Students & Fees", [
            request("List students", "GET", "/students", post=[
                "if (pm.response.code === 200 && pm.response.json().length) {",
                "  pm.environment.set('studentId', pm.response.json()[0].id);",
                "}",
            ]),
            request("Get student", "GET", "/students/{{studentId}}"),
            request("List student fees", "GET", "/students/{{studentId}}/fees",
                    query=[("status", "UNPAID", False)],
                    description="Optional `status`: OUTSTANDING | PARTIALLY_PAID | PAID | UNPAID."),
            request(
                "Outstanding fees", "GET", "/fees/outstanding",
                query=[("student_id", "{{studentId}}", False), ("overdue_only", "true", False)],
                post=[
                    "// Picks the first unpaid fee for the payment requests.",
                    "if (pm.response.code === 200 && pm.response.json().items.length) {",
                    "  pm.environment.set('feeId', pm.response.json().items[0].id);",
                    "}",
                ],
            ),
            request("Fee details", "GET", "/fees/{{feeId}}"),
            request("Dashboard", "GET", "/dashboard"),
        ]),
        folder("Payments", [
            request(
                "Create payment (new key)", "POST", "/payments",
                headers=[{"key": "Idempotency-Key", "value": "{{idempotencyKey}}"}],
                body={"fee_id": "{{feeId}}", "amount_cents": "{{amountCents}}", "payment_method": "CARD"},
                pre=NEW_KEY, post=SET_PAYMENT_ID,
                description="201 Created. Generates a new Idempotency-Key and stores `paymentId`.",
            ),
            request(
                "Create payment (replay same key)", "POST", "/payments",
                headers=[{"key": "Idempotency-Key", "value": "{{idempotencyKey}}"}],
                body={"fee_id": "{{feeId}}", "amount_cents": "{{amountCents}}", "payment_method": "CARD"},
                description="Re-sends the previous key and body: 200 OK, `Idempotent-Replayed: true`, same payment.",
            ),
            request(
                "Create payment (same key, different body - 422)", "POST", "/payments",
                headers=[{"key": "Idempotency-Key", "value": "{{idempotencyKey}}"}],
                body={"fee_id": "{{feeId}}", "amount_cents": 101, "payment_method": "CARD"},
                description="422 IDEMPOTENCY_KEY_REUSED.",
            ),
            request(
                "Create payment (missing key - 400)", "POST", "/payments",
                body={"fee_id": "{{feeId}}", "amount_cents": "{{amountCents}}", "payment_method": "CARD"},
                description="400 IDEMPOTENCY_KEY_MISSING.",
            ),
            request(
                "Create payment (amount exceeds balance - 422)", "POST", "/payments",
                headers=[{"key": "Idempotency-Key", "value": "{{$guid}}"}],
                body={"fee_id": "{{feeId}}", "amount_cents": 99999999, "payment_method": "CARD"},
            ),
            request("Get payment", "GET", "/payments/{{paymentId}}"),
            request("Get payment status", "GET", "/payments/{{paymentId}}/status",
                    description="Lightweight polling endpoint; `retry_after_ms` is set while PROCESSING."),
            request("Confirm - success (200)", "POST", "/payments/{{paymentId}}/confirm",
                    body=card("4242424242424242"), description=confirm_desc),
            request("Confirm - declined (200, FAILED)", "POST", "/payments/{{paymentId}}/confirm",
                    body=card("4000000000000002"), description=confirm_desc),
            request("Confirm - insufficient funds (200, FAILED)", "POST", "/payments/{{paymentId}}/confirm",
                    body=card("4000000000009995"), description=confirm_desc),
            request("Confirm - gateway error (502)", "POST", "/payments/{{paymentId}}/confirm",
                    body=card("4000000000000119"),
                    description=confirm_desc + " Payment returns to PENDING and can be confirmed again."),
            request("Confirm - gateway timeout (504)", "POST", "/payments/{{paymentId}}/confirm",
                    body=card("4000000000001018"),
                    description=confirm_desc + " Payment stays PROCESSING, then settles as FAILED."),
            request("Confirm - async pending (202)", "POST", "/payments/{{paymentId}}/confirm",
                    body=card("4000000000002024"),
                    description=confirm_desc + " Payment stays PROCESSING, then settles as SUCCEEDED."),
            request("Confirm - invalid card (422)", "POST", "/payments/{{paymentId}}/confirm",
                    body={"card": {"number": "4242424242424241", "expiry_month": 13, "expiry_year": 2020,
                                   "cvc": "1", "holder_name": ""}}),
            request("Cancel payment", "POST", "/payments/{{paymentId}}/cancel",
                    description="Only PENDING payments can be cancelled; otherwise 409 PAYMENT_NOT_CANCELLABLE."),
        ]),
        folder("Transactions", [
            request(
                "List transactions", "GET", "/transactions",
                query=[
                    ("page", "1", True),
                    ("page_size", "10", True),
                    ("status", "SUCCEEDED", False),
                    ("status", "FAILED", False),
                    ("student_id", "{{studentId}}", False),
                    ("fee_id", "{{feeId}}", False),
                    ("date_from", "2026-01-01", False),
                    ("date_to", "2026-12-31", False),
                ],
            ),
            request("List transactions with simulated delay", "GET", "/transactions",
                    headers=[{"key": "X-Simulate-Delay-Ms", "value": "1500"}],
                    query=[("page", "1", True)]),
        ]),
        folder("Development", [
            request("Reset database", "POST", "/dev/reset", auth=False,
                    query=[("load_test_users", "50", False), ("reset_simulation", "true", False)],
                    description="Drops and re-seeds everything. All tokens become invalid."),
            request("Get simulation settings", "GET", "/dev/simulation", auth=False),
            request("Update simulation settings", "PUT", "/dev/simulation", auth=False, body={
                "response_delay_ms": 0,
                "response_jitter_ms": 0,
                "endpoint_delays_ms": {"GET /api/v1/transactions": 500},
                "gateway_latency_ms": 800,
                "gateway_timeout_ms": 5000,
                "pending_resolution_seconds": 8,
                "payment_outcome_override": "none",
                "gateway_error_every_n": 0,
            }, description="Partial update - send only the fields to change."),
            request("Reset simulation settings", "DELETE", "/dev/simulation", auth=False),
            request("List test cards", "GET", "/dev/test-cards", auth=False),
        ], description="Available only when APP_ENV != production and ENABLE_DEV_ENDPOINTS=true."),
    ]

    return {
        "info": {
            "name": "School Fees API (simulated)",
            "description": "Practice API for a simulated school-fee payment app. Import together with "
            "`SchoolFees.local.postman_environment.json`, run **Auth / Login** first, then "
            "**Students & Fees / Outstanding fees** to pick a fee.",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "auth": {"type": "bearer", "bearer": [{"key": "token", "value": "{{accessToken}}", "type": "string"}]},
        "item": items,
    }


def build_environment() -> dict:
    values = {
        "baseUrl": "http://127.0.0.1:8000/api/v1",
        "email": "thandi.mokoena@example.com",
        "password": "Password123!",
        "accessToken": "",
        "studentId": "stu_1001",
        "feeId": "fee_1003",
        "amountCents": "10000",
        "paymentId": "",
        "idempotencyKey": "",
    }
    return {
        "name": "School Fees - Local",
        "values": [{"key": k, "value": v, "type": "default", "enabled": True} for k, v in values.items()],
        "_postman_variable_scope": "environment",
    }


if __name__ == "__main__":
    COLLECTION_FILE.write_text(json.dumps(build_collection(), indent=2) + "\n", encoding="utf-8")
    ENVIRONMENT_FILE.write_text(json.dumps(build_environment(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {COLLECTION_FILE.name} and {ENVIRONMENT_FILE.name}")
