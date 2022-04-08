import { mime } from "./deps.ts";
import { JSONCreateRequest } from "./index.ts";

export function formDataToJSON(formData: FormData): JSONCreateRequest {
  const type = 'h-' + (formData.get('h')?.toString() ?? 'entry');
  const content = formData.get('content')?.toString() ?? '';
  const properties: Record<string, Array<string | File>> = {};

  for (const [key, val] of formData.entries()) {
    const disallowedKeys = ['content'];

    if (!disallowedKeys.includes(key)) {
      if (key.includes('[')) {
        const cleanKey = key.split('[')[0];

        if (Array.isArray(properties[cleanKey])) {
          properties[cleanKey].push(val?.toString());
        } else {
          properties[cleanKey] = [val?.toString()];
        }
      } else {
        properties[key] = [val?.toString()];
      }
    }
  }

  return {
    type,
    properties: {
      content: [content],
      ...properties
    }
  }
}
