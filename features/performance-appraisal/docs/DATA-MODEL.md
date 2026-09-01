# BexHR Performance Appraisal — Data Model

**Status:** Draft for approval  
**Purpose:** Define the records and relationships required by the core appraisal feature.

This document describes business data only. It is not yet a Supabase or SQL schema.

## 1. Data ownership

Existing BexHR records remain responsible for:

- Organisations
- Users
- Employees
- Departments
- Job titles
- Reporting managers
- Roles and permissions

The appraisal feature will reference those existing records using their IDs.

It must not create duplicate employee, department, manager or organisation records.

An appraisal may retain a historical snapshot of the employee's name, job title, department and manager so that an old appraisal remains accurate after an employee transfer or role change.

## 2. Shared record information

Every appraisal record must contain:

- Record ID
- Organisation ID
- Created by
- Created date and time
- Last updated by
- Last updated date and time

Closed appraisals are read-only.

Audit entries are append-only and must not be silently overwritten.

## 3. Core records

### 3.1 Appraisal Cycle

Defines one appraisal period.

Required information:

- Cycle ID
- Organisation ID
- Cycle name
- Start date
- End date
- Goal-setting deadline
- Employee self-appraisal deadline
- Manager review deadline
- HR review deadline
- Status

### 3.2 Organisation Goal

Defines an organisation-wide performance goal.

Required information:

- Goal ID
- Cycle ID
- Title
- Description
- Performance metric or KPI
- Target
- Responsible owner
- Start date
- Due date
- Status

### 3.3 Organisational Deliverable

Defines a measurable result attached to an organisation goal.

Required information:

- Deliverable ID
- Organisation goal ID
- Title
- Expected result
- Responsible owner
- Due date
- Status

A deliverable cannot exist without an organisation goal.

### 3.4 Department Goal

Defines a department-level goal.

Required information:

- Department goal ID
- Cycle ID
- Department ID
- Linked organisation goal ID, where applicable
- Title
- Description
- Performance metric or KPI
- Target
- Responsible manager ID
- Start date
- Due date
- Status

### 3.5 Employee Appraisal

Represents one employee's appraisal within one cycle.

Required information:

- Appraisal ID
- Cycle ID
- Employee ID
- Manager ID
- Department ID
- Employee name snapshot
- Job title snapshot
- Department snapshot
- Manager name snapshot
- Current appraisal status
- Final score
- Final rating
- Finalised date
- Closed date

One employee can have only one appraisal in the same cycle.

### 3.6 Individual Goal

Defines one goal assigned to an employee appraisal.

Required information:

- Individual goal ID
- Appraisal ID
- Linked department goal ID, where applicable
- Title
- Description
- Performance metric or KPI
- Target
- Weight
- Start date
- Due date
- Progress percentage
- Progress status
- Approved by
- Approved date

The combined weight of all approved goals within one appraisal must equal exactly 100%.

### 3.7 Progress Update

Records an employee's progress against an individual goal.

Required information:

- Progress update ID
- Individual goal ID
- Employee ID
- Progress percentage
- Progress status
- Progress comment
- Evidence note or reference
- Update date

One individual goal may have several progress updates.

### 3.8 Goal Review

Stores the employee and manager assessment for one individual goal.

Required information:

- Goal review ID
- Individual goal ID
- Actual result
- Employee achievement comment
- Employee self-rating
- Manager rating
- Manager comment
- Final approved rating

One individual goal has one current goal review.

Earlier changes remain available through the audit history.

### 3.9 Employee Self-Appraisal

Stores the employee's overall appraisal submission.

Required information:

- Self-appraisal ID
- Appraisal ID
- Overall performance summary
- Challenges encountered
- Development or training needs
- Submitted date

One employee appraisal has one current self-appraisal.

### 3.10 Manager Appraisal

Stores the manager's overall review.

Required information:

- Manager appraisal ID
- Appraisal ID
- Overall performance comment
- Employee strengths
- Improvement areas
- Development recommendations
- Proposed final rating
- Submitted date

One employee appraisal has one current manager appraisal.

### 3.11 HR Review

Stores HR's review decision.

Required information:

- HR review ID
- Appraisal ID
- Decision
- Final score
- Final rating
- Return reason, where applicable
- Rating adjustment reason, where applicable
- Reviewed by
- Reviewed date

The allowed decisions are:

- Returned to Manager
- Finalised

### 3.12 Employee Acknowledgement

Records the employee's response to the final appraisal.

Required information:

- Acknowledgement ID
- Appraisal ID
- Employee ID
- Acknowledged date
- Final employee comment
- Disagreement recorded

Acknowledgement confirms receipt and discussion. It does not automatically mean agreement.

### 3.13 Audit Entry

Records important appraisal actions.

Required information:

- Audit entry ID
- Organisation ID
- Appraisal ID
- Action
- Performed by
- User role
- Previous value, where applicable
- New value, where applicable
- Reason, where required
- Date and time

## 4. Main relationships

```text
Appraisal Cycle
|-- Organisation Goals
|   |-- Organisational Deliverables
|   `-- Department Goals
`-- Employee Appraisals
    |-- Individual Goals
    |   |-- Progress Updates
    |   `-- Goal Review
    |-- Employee Self-Appraisal
    |-- Manager Appraisal
    |-- HR Review
    |-- Employee Acknowledgement
    `-- Audit Entries
```

## 5. Core data rules

- Every appraisal record belongs to one organisation.
- Every employee appraisal belongs to one appraisal cycle.
- One employee cannot have duplicate appraisals in the same cycle.
- Every individual goal belongs to one employee appraisal.
- Approved individual goal weights must total exactly 100%.
- Submitted employee and manager reviews become read-only unless returned.
- HR rating changes and reopened appraisals require a reason.
- Closed appraisals remain read-only.
- Existing BexHR employee records must not be edited or duplicated.
- Important appraisal changes must remain available in the audit history.