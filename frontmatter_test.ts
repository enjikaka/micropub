import { assertEquals } from "https://deno.land/std@0.133.0/testing/asserts.ts";
import { encodeMdMetadata, decodeMdMetadata } from './frontmatter.ts';

Deno.test("can decode correctly", () => {
  const src = {
    photo: [ { value: "https://micropub.rocks/media/sunset.jpg", alt: "Photo of a sunset" } ],
    date: [ "2022-04-08" ],
    postId: [ "2022-04-08-2b0a7b" ]
  };
  const encoded = encodeMdMetadata(src);
  const decoded = decodeMdMetadata(encoded);

  assertEquals(decoded, src);
});

Deno.test("can encode correctly", () => {
  const src = {
    date: ["2022-12-12"],
    category: ["test1", "test2"],
    photo: [{ value: "", alt: "" }],
    draft: true
  }
  const result = encodeMdMetadata(src);

  const expected = `---
date: 2022-12-12
category: ["test1","test2"]
photo: [{"value":"","alt":""}]
draft: true
---`;

  assertEquals(result, expected);
});
