# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in skilltree, please report it responsibly.

Please use [GitHub's private vulnerability reporting](https://github.com/imarios/skilltree/security/advisories/new) to submit your report. This ensures the issue stays private until a fix is available.

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact

I will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

skilltree executes git operations and installs files into your project. Security-relevant areas include:
- Git clone/fetch operations (URL handling)
- File installation paths (directory traversal prevention)
- Optional LLM scanning (API key handling)
