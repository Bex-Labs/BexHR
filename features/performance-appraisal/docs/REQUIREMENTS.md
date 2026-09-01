# BexHR Performance Appraisal — Requirements

**Status:** Draft for approval  
**Module:** Performance Appraisal  
**Branch:** `feat/performance-appraisal`

## 1. Purpose

The Performance Appraisal feature will help organisations manage employee performance from goal setting to final review.

It must support the normal appraisal process used by organisations, including organisations in Nigeria, without being designed for one particular company or industry.

The core process covers:

- Organisation goals and deliverables
- Department goals
- Individual employee goals
- Progress updates
- Employee self-appraisal
- Manager appraisal
- HR review and finalisation
- Employee acknowledgement
- Appraisal history and basic reports

Appraisal dates must be configurable. The feature must not assume that every organisation uses a January-to-December appraisal year.

## 2. Users

### Employee

The employee can:

- View their own appraisal and approved goals
- Update goal progress
- Add achievement comments and evidence references
- Complete and submit a self-appraisal
- View the final appraisal
- Acknowledge the final appraisal
- View previous closed appraisals

### Manager

The manager can:

- View appraisals for permitted direct reports
- Create and approve individual employee goals
- Monitor employee progress
- Review employee self-appraisals
- Rate each employee goal
- Add feedback and development recommendations
- Return an incomplete self-appraisal with a reason
- Submit completed appraisals to HR

### HR Standard

An HR Standard user can perform appraisal activities allowed by their existing permissions, including:

- Monitor appraisal progress
- Review submitted appraisals
- Return incomplete appraisals with a reason
- View permitted appraisal reports

### HR Admin

An HR Admin can:

- Create and manage appraisal cycles
- Create organisation and department goals
- Add organisational deliverables
- Configure appraisal deadlines and rating settings
- Review and finalise appraisals
- Adjust a proposed rating with a reason
- Reopen a closed appraisal with a reason
- View appraisal reports and audit history

### BexAdmin

BexAdmin can:

- Enable or disable the appraisal feature for an organisation
- Support feature configuration
- Investigate technical problems
- View system-level operational information

BexAdmin must not automatically receive access to confidential employee appraisal content.

## 3. Core workflow

1. HR Admin creates an appraisal cycle.
2. HR Admin records organisation goals and related deliverables.
3. Department goals are linked to relevant organisation goals.
4. Managers assign individual goals to employees.
5. Individual goal weights must total exactly 100%.
6. Managers approve the individual goals.
7. Employees update progress during the appraisal period.
8. Employees complete and submit their self-appraisals.
9. Managers review, rate, comment and submit appraisals to HR.
10. HR reviews, returns or finalises each appraisal.
11. Employees view and acknowledge their final appraisals.
12. Finalised appraisals are closed and retained in appraisal history.

## 4. Core features

### Appraisal cycle

An appraisal cycle must contain:

- Cycle name
- Start date
- End date
- Goal-setting deadline
- Employee self-appraisal deadline
- Manager review deadline
- HR review deadline
- Status

### Goals and deliverables

The feature must support:

- Organisation goals
- Organisational deliverables
- Department goals
- Individual employee goals

An organisational deliverable must belong to an organisation goal. It will record an expected result and must not become a separate project-management system.

An individual goal must contain:

- Goal title
- Description
- Performance metric or KPI
- Target
- Weight
- Start date
- Due date
- Progress status

Department goals should link to organisation goals. Individual goals should link to department goals where applicable.

### Progress updates

An employee can record:

- Progress percentage
- Progress status
- Progress comment
- Evidence note or reference
- Update date

Progress statuses are:

- Not Started
- In Progress
- At Risk
- Completed

### Employee self-appraisal

The employee can record:

- Achievement against each goal
- Actual result
- Self-rating
- Supporting comment
- Challenges encountered
- Overall performance summary
- Development or training needs

### Manager appraisal

The manager can record:

- Rating for each goal
- Comment for each goal
- Overall performance comment
- Employee strengths
- Improvement areas
- Development recommendations
- Proposed final rating

### HR review

HR can:

- Review employee and manager submissions
- Return an appraisal with a reason
- Accept the manager's proposed rating
- Adjust the proposed rating with a reason
- Finalise the appraisal

When HR changes a manager rating, the original rating must remain in the audit history.

### Employee acknowledgement

After finalisation, the employee can:

- View the final appraisal
- Confirm that it was received and discussed
- Add an optional final comment
- Record disagreement where necessary

Acknowledgement confirms receipt and discussion. It does not mean the employee agrees with every rating.

## 5. Appraisal statuses

The core statuses are:

```text
DRAFT
GOALS_PENDING_APPROVAL
ACTIVE
SELF_REVIEW_PENDING
MANAGER_REVIEW_PENDING
HR_REVIEW_PENDING
ACKNOWLEDGEMENT_PENDING
CLOSED