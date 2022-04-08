export function decodeMdMetadata (text: string): Record<string, any> {
  const metaDataBlock = text.split('---')[1].split('---')[0];
  const nonEmptyLines = metaDataBlock.split('\n').filter(Boolean);
  const metaData = nonEmptyLines.reduce((acc, curr) => {
    const [key, val] = curr.split(': ');

    let value = val;

    try {
      value = JSON.parse(val);
    } catch (e) {}

    acc[key] = Array.isArray(value) ? value : [value];

    return acc;
  }, {} as Record<string, any>);

  return metaData;
}

export function encodeMdMetadata (metadata: Record<string, boolean | Array<string | { value: string, alt: string }>>): string {
  const lines = ['---'];

  for (const [key, val] of Object.entries(metadata)) {
    const disallowedKeys = ['content', 'photo'];

    if (!disallowedKeys.includes(key)) {
      if (val === true || val === false) {
        lines.push(`${key}: ${val}`);
      } else {
        lines.push(`${key}: ${val.length > 1 ? JSON.stringify(val) : typeof val[0] === 'object' ? JSON.stringify(val[0]): val[0]}`);
      }
    }

    if (key === 'photo' && val !== true && val !== false) {
      const photos = val.map(p => {
        const rawPhoto = p as unknown as string | { value: string, alt: string };

        return {
          value: typeof rawPhoto === 'string' ? rawPhoto : rawPhoto.value,
          alt: typeof rawPhoto === 'string' ? '' : rawPhoto.alt
        };
      });

      lines.push('photo: ' + JSON.stringify(photos));
    }
  }

  lines.push('---');

  return lines.join('\n');
}
