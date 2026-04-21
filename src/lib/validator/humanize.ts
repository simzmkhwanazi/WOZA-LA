/**
 * Converts raw validation issue messages into plain-English descriptions
 * that a non-technical clerk can understand.
 */

import type { Issue } from './index';

const PLAIN_ENGLISH: Record<string, string> = {
  client_name:       'Client name is missing',
  entity_type:       'Entity type is missing (e.g. PTY LTD, INDIVIDUAL, TRUST)',
  year_end:          'Year-end month is missing (e.g. February)',
  registration_nr:   'Registration number is missing — required for companies, CCs, NPOs and trusts. Return to firm if unknown.',
  id_number:         'SA ID / Passport number is missing — required for individuals and sole proprietors. Enter the 13-digit ID number and Date of Birth will be filled automatically.',
  trust_deed_number: 'Trust deed number is missing — required for trusts. Return to firm if unknown.',
  status:            'Client status is missing (e.g. Active, Dormant)',
  tax_nr:            'Income tax number is missing — required for all tax-registered clients. Check the SARS eFiling profile or return to firm.',
  vat_nr:            'VAT registration number is missing — required for VAT-registered clients. Check the SARS eFiling profile.',
  contact_email:     'Email address format is invalid — check for typos or spaces',
  contact_nr:        'Phone number is missing or invalid',
  partner:           'Partner is not assigned — select from the staff list or type a name',
  manager:           'Manager is not assigned — select from the staff list or type a name',
  accountant:        'Accountant is not assigned — use the Assign Accountant panel above or edit the record directly',
};

/** Returns a human-readable version of a validation issue. */
export function humanizeIssue(issue: Issue): string {
  // Status-as-name error has a self-explanatory message — pass it through directly
  if (issue.field === 'client_name' && issue.message.includes('looks like a status value')) {
    return issue.message + '. Open the record and type the actual company or person name.';
  }

  const plain = PLAIN_ENGLISH[issue.field];
  if (plain && issue.message.toLowerCase().includes('required')) return plain;
  // For format/enum errors, simplify the technical detail
  if (issue.message.includes('not in allowed list')) {
    const match = issue.message.match(/Value "(.+)" not in allowed list for (.+)/);
    if (match) return `"${match[1]}" is not a valid ${match[2]} — please correct it`;
  }
  if (issue.message.includes('Date must be')) {
    return `Date must be in dd/mm/yyyy format`;
  }
  if (issue.message.includes('Invalid email')) {
    return issue.message;
  }
  if (issue.message.includes('Expected TRUE/FALSE')) {
    return `Expected Yes or No, got an unrecognised value`;
  }
  return issue.message;
}
