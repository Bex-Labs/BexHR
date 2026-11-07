/* BexHR Phase 7A9: wording help only, never mutate payroll form values. */
(function () {
  'use strict';

  const adjustmentDescriptions = Object.freeze({
    BONUS: 'Adds a one-time bonus to this employee\'s earnings for the chosen month. The payroll calculation includes it in taxable pay where applicable.',
    OVERTIME: 'Adds one-time overtime pay to this employee\'s earnings for the chosen month. Payroll calculates any applicable PAYE.',
    OTHER_ALLOWANCE: 'Adds another approved earning for this month only. For an allowance that should continue, use Allowance Components instead.',
    OTHER: 'Subtracts a one-time approved amount from take-home pay in the chosen month. This is not automatically a PAYE tax relief.'
  });

  function initialize() {
    const adjustmentSelect = document.getElementById('payrollEmployeeOverrideElement');
    const adjustmentHelp = document.getElementById('bexhrPayrollAdjustmentTypeHelp');
    const allowanceSelect = document.getElementById('payrollAllowanceType');
    const allowanceHelp = document.getElementById('bexhrPayrollAllowanceTypeHelp');

    if (adjustmentSelect && adjustmentHelp && !adjustmentSelect.dataset.bexhrPayrollClarityBound) {
      adjustmentSelect.dataset.bexhrPayrollClarityBound = 'true';
      const updateAdjustmentHelp = () => {
        const value = String(adjustmentSelect.value || '').trim();
        adjustmentHelp.textContent = adjustmentDescriptions[value] ||
          'Bonus, Overtime and Other Earning add to pay. Other Deduction subtracts from pay. BexHR applies the amount when payroll is prepared, not when you save this form.';
      };
      adjustmentSelect.addEventListener('change', updateAdjustmentHelp);
      adjustmentSelect.addEventListener('focus', updateAdjustmentHelp);
      updateAdjustmentHelp();
    }

    if (allowanceSelect && allowanceHelp && !allowanceSelect.dataset.bexhrPayrollClarityBound) {
      allowanceSelect.dataset.bexhrPayrollClarityBound = 'true';
      const updateAllowanceHelp = () => {
        const value = String(allowanceSelect.value || '').toLowerCase().trim();
        if (value === 'other' || value === 'other allowance') {
          allowanceHelp.textContent = 'Other is the built-in 20% share of the current Regular gross salary split, not an extra payment. It is calculated automatically from Employee Salary Setup.';
        } else if (value === 'bonus' || value === 'overtime') {
          allowanceHelp.textContent = 'This allowance setup can apply to later payrolls while active. For one month of ' + value + ' only, use Payroll Adjustments instead.';
        } else if (value === 'medical' || value === 'logistics allowance' || value === 'data & airtime') {
          allowanceHelp.textContent = 'This is a separately approved earning under Allowance Components. For a one-month-only amount, use Payroll Adjustments.';
        } else {
          allowanceHelp.textContent = 'The current Regular salary split includes Basic, Housing, Transport, Utility and Other. These are portions of agreed gross salary, not five extra payments.';
        }
      };
      allowanceSelect.addEventListener('change', updateAllowanceHelp);
      allowanceSelect.addEventListener('focus', updateAllowanceHelp);
      updateAllowanceHelp();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
