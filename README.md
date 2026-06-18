# BexHR

A comprehensive HR and Payroll management system designed for automated salary processing, employee record management, and regulatory tax compliance.

## Overview

BexHR is a digital HR and payroll management platform built to help organisations manage employee records, payroll workflows, salary processing, payslips, staff documentation, and compliance-related payroll operations from a central system.

The platform provides dedicated interfaces for HR administrators, employees, and managers, supporting structured workforce management and operational visibility across key HR processes.

## Live Application

https://app.bexhr.com/

## Key Features

* Employee profile and staff record management
* HR dashboard for workforce administration
* Employee dashboard for staff self-service access
* Manager dashboard for team-level visibility
* Payroll processing support
* Payslip and salary record workflows
* Employee document and supporting file management
* Leave and entitlement management support
* Regulatory payroll and tax compliance support
* Authentication-enabled access control
* Validation and audit-focused HR workflows
* Responsive user interface for modern web access

## Tech Stack

* HTML5
* CSS3
* JavaScript
* TypeScript
* Supabase
* Supabase Auth
* PostgreSQL
* Playwright
* Vercel

## Project Structure

```text
BexHR/
├── assets/
├── css/
├── e2e/
├── js/
├── supabase/
├── admin-dashboard.html
├── employee-dashboard.html
├── hr-dashboard.html
├── manager-dashboard.html
├── index.html
├── reset-password.html
├── package.json
├── playwright.config.js
├── wrangler.jsonc
└── README.md
```

## Dashboards

### HR Admin Dashboard

The HR dashboard supports central HR administration, including employee record management, payroll-related workflows, documentation, and operational oversight.

### Employee Dashboard

The employee dashboard provides staff-facing access to relevant employee information and HR self-service features.

### Manager Dashboard

The manager dashboard supports team-level visibility and management-related workflows.

## Authentication and Access

BexHR uses authentication-enabled access patterns to support controlled access to HR and payroll data. The platform is structured to separate user journeys across HR, employee, and manager-facing areas.

Sensitive configuration values, environment variables, API keys, and database credentials must not be committed to the repository.

## Testing

The project includes Playwright-based testing support for end-to-end validation and workflow checks.

Typical test command:

```bash
npx playwright test
```

## Deployment

BexHR is deployed as a web application and is available at:

```text
https://app.bexhr.com/
```

Deployment is managed separately from the source repository. Production configuration, environment variables, and platform credentials should be managed securely through the deployment provider.

## Status

Current status: Production-ready active project

## Organisation

Built by Bex Innovation Labs.
