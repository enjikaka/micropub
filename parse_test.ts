import { assertEquals } from "https://deno.land/std@0.133.0/testing/asserts.ts";
import parse from './parse.ts';

Deno.test("parse", () => {
  const result = parse('h=entry&content=hello+world&category[]=foo&category[]=bar');

  assertEquals(result, {
    type: ['h-entry'],
    properties: {
      content: 'hello world',
      category: ['foo', 'bar']
    }
  });
});
