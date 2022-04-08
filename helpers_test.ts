import { assertEquals } from "https://deno.land/std@0.133.0/testing/asserts.ts";
import { formDataToJSON } from './helpers.ts';

Deno.test("formDataToJSON", () => {
  const fd = new FormData();

  fd.append('h', 'entry');
  fd.append('content', 'hello world');
  fd.append('category[]', 'foo');
  fd.append('category[]', 'bar');

  const result = formDataToJSON(fd);

  assertEquals(result, {
    type: 'h-entry',
    properties: {
      content: ['hello world'],
      category: ['foo', 'bar'],
      h: ['entry']
    }
  });
});
