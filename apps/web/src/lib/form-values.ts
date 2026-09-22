/**
 * React 19 resets uncontrolled form fields after a form action completes.
 * Actions return the submitted values on error so forms can re-render them as
 * defaults and the user never loses their input.
 */
export type FormValues = Record<string, string>;

export function formValues(formData: FormData): FormValues {
  const values: FormValues = {};
  formData.forEach((value, key) => {
    if (typeof value === 'string' && !key.startsWith('$ACTION')) values[key] = value;
  });
  return values;
}
