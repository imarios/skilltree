---
name: architecture-review
description: System architecture review and design critique
---

# Architecture Review

## Principles

Every architecture decision should be evaluated against scalability, maintainability, and security posture. Consider how the system handles failure modes and what monitoring is in place.

## Review Process

Examine the request flow end-to-end. Check that data validation happens at system boundaries. Verify that error handling is consistent and doesn't leak internal details. Ensure database queries are parameterized and connections are pooled.

## Documentation

Architecture decisions should be recorded as ADRs. Each decision must include the context, options considered, decision made, and consequences.

## Deployment Considerations

Review how changes will be rolled out. Consider canary deployments for high-risk changes. Ensure rollback procedures are documented and tested.
