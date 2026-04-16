/**
 * Converts raw validation issue messages into plain-English descriptions
 * that a non-technical clerk can understand.
 */

import type { Issue } from './index';

const PLAIN_ENGLISH: Record<string, string> = {
  client_name:      'Client name is missing',
  entity_type:      'Entity type is missing (e.g. PTY LTD, INDIVIDUAL, TRUST)',
  year_end:         'Year-end month is missing (e.g. February)',
  registration_nr:  'Registration number is missing — needed for companies, CCs, and NPOs',
  id_number:        'ID number is missing — needed for individuals and sole proprietors',
  trust_deed_number:'Trust deed number is missing',
  status:           'Client status is missing (e.g. Active, Dormant)',
  tax_nr:           'Income tax number is missing',
  vat_nr:           'VAT registration number is missing',
  contact_email:    'Email address format is invalid',
  contact_nr:       'Phone number is missing or invalid',
};

/** Returns a human-readable version of a validation issue. */
export function humanizeIssue(issue: Issue): string {
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
