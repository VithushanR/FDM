import type { FormGroup } from "../api/endpoints";

// The label a dropdown code shows, from the schema. Codes are never shown in the report.
export function optionLabel(groups: FormGroup[], field: string, code: string): string | undefined {
  for (const group of groups) {
    for (const item of group.fields) {
      if (item.name !== field) continue;
      return item.options.find((option) => option.value === code)?.label;
    }
  }
  return undefined;
}
