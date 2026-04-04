---
name: secure-deployment
description: Secure deployment practices for production systems
---

# Secure Deployment

## Pre-Deployment Checklist

Before deploying to production, ensure all code has been through a thorough review process. Security vulnerabilities must be identified and remediated. Run the full test suite with coverage thresholds enforced.

## Security Requirements

All API endpoints must validate input according to OWASP guidelines. Authentication tokens should be rotated on deployment. Follow secure coding practices throughout — never trust user input, always sanitize database queries, and enforce principle of least privilege.

## Monitoring

After deployment, verify that logging captures all authentication events. Set up alerts for anomalous traffic patterns. Ensure error rates stay within acceptable thresholds.

## Rollback Procedure

If metrics degrade after deployment, initiate an immediate rollback. Document the failure and add regression tests to prevent recurrence.
