interface MicroFormatObject {
  type: string[];
  properties: Record<string, any>;
}

export default function parseCreateData (xWwwFormUrlencoded: string): MicroFormatObject {
  const params = new URLSearchParams(xWwwFormUrlencoded);
  const obj: MicroFormatObject = {
    type: [],
    properties: {}
  };

  for (const [key, value] of params.entries()) {
    if (key === 'h') {
      obj.type = ['h-' + value];
    } else {
      if (key.includes('[]')) {
        const arrayKey = key.split('[')[0];

        if (Array.isArray(obj.properties[arrayKey])) {
          obj.properties[arrayKey].push(value);
        } else if (!obj.properties[arrayKey]) {
          obj.properties[arrayKey] = [value];
        } else {
          throw new TypeError(`Key ${arrayKey} is not an array or undefined. What have you done?`);
        }
      } else {
        obj.properties[key] = value;
      }
    }
  }

  return obj;
}
