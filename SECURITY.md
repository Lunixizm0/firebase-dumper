# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| main / latest release | :white_check_mark: |
| older releases | :x: |

Only the latest release and the `main` branch receive security fixes.

## Reporting a Vulnerability

If you find a security issue in `firebase-dumper`
Report privately using one of the following:

- **GitHub Private Vulnerability Reporting** (preferred): open a report via the repo's [Security tab → "Report a vulnerability"](../../security/advisories/new)
- **Email**: security@lunixizm.website

Please include:
- A clear description of the vulnerability and its impact
- Steps to reproduce, or a minimal PoC if possible
- Affected version/commit
- Any suggested remediation, if you have one

## Response Process

- **Acknowledgement**: within 3 business days of report
- **Initial triage/severity assessment**: within 5 business days
- **Fix or mitigation timeline**: communicated once severity is confirmed; critical issues are prioritized for immediate patching
- You will be credited in the fix commit/changelog and advisory unless you request anonymity

## Disclosure Policy

This project follows **coordinated disclosure**:
- Please give us reasonable time to investigate and patch before any public disclosure
- We aim to resolve confirmed critical/high severity issues within 10 days of report
- If a fix isn't possible within that window, we'll communicate an updated timeline directly with you
- Once a fix is released, we're happy to coordinate a mutually agreed disclosure date and credit you in the advisory

## Scope

In scope:
- `firebase-dumper` source code, and dependencies as pinned in `package.json`
